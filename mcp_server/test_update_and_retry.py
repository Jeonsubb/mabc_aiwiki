"""같은 세션 갱신 + 실패 후 재시도 흐름을 확인한다.

1) MCP submit_conversation으로 세션 저장 + 분석 요청 등록
2) MCP 서버 연결 유지 상태에서 첫 pending 처리
3) 같은 session_id로 새 원문 제출 → 갱신 요청 등록
4) 두 번째 pending 처리
5) get_session_graph_request로 최종 상태 확인

가짜 LLM을 사용한다.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

MCP_SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mcp_server"))
sg_dir = os.path.abspath(os.path.join(MCP_SERVER_DIR, "..", "session-graph"))
root = os.path.abspath(os.path.join(MCP_SERVER_DIR, ".."))
for p in (root, sg_dir):
    if p not in sys.path:
        sys.path.insert(0, p)

from mcp import Client
from mcp.client.stdio import StdioServerParameters
from mcp_server.test_fake_llm import install_fake_openai, uninstall_fake_openai


def _tool_text(result) -> str:
    for block in (getattr(result, "content", []) or []):
        kind = getattr(block, "type", None)
        if kind == "text":
            return getattr(block, "text", "") or ""
    return ""


def _unwrap_mcp_result(result) -> dict:
    text = _tool_text(result)
    if not text:
        return {}
    try:
        outer = json.loads(text)
    except json.JSONDecodeError:
        return {}
    inner_text = None
    for block in (outer.get("content") or []):
        if isinstance(block, dict) and block.get("type") == "text":
            inner_text = block.get("text")
            break
    if inner_text:
        try:
            return json.loads(inner_text)
        except json.JSONDecodeError:
            return {}
    return outer


async def call(client: Client, tool: str, params: dict) -> dict:
    return _unwrap_mcp_result(await client.call_tool(tool, params))


def run_worker_once(session_id_filter: str):
    from session_graph_api import get_session_graph
    from mcp_server.session_graph_bridge import dequeue_one, mark_done
    from mcp_server.session_graph_bridge import dequeue_one, mark_done

    item = dequeue_one()
    if item is None:
        return {"status": "no_pending", "req_id": None}

    from session_graph_api import ingest_session, get_session_graph
    user_id = item.get("userId") or item.get("user_id") or ""
    result = ingest_session(
        session_id=item["session_id"],
        original_text=item["original_text"],
        run_judgment=item.get("run_judgment", True),
        force_refresh=False,
        user_id=user_id,
    )
    analysis_status = result.get("analysis_status", "ok")
    conn_file = result.get("connections_file")
    conn_count = 0
    if conn_file and os.path.exists(conn_file):
        with open(conn_file, encoding="utf-8") as f:
            payload = json.load(f)
        conn_count = len(payload.get("connections", []))
    if analysis_status == "fail":
        mark_done(item["id"], result=result, error="분석 실패(추출/개념/GraphML)")
    else:
        mark_done(item["id"], result={"connection_file": conn_file, "connections": conn_count})

    graph = get_session_graph(session_id_filter=item["session_id"], user_id=user_id)
    node = next((n for n in graph["nodes"] if n["id"] == item["session_id"]), None)
    return {
        "req_id": item["id"],
        "session_id": item["session_id"],
        "status": "ok",
        "has_extraction": bool(node.get("has_extraction")) if node else False,
        "has_concept_graphml": bool(node.get("has_concept_graphml")) if node else False,
        "graphml_path": node.get("graphml_path") if node else None,
        "connections_count": conn_count,
    }


async def main() -> None:
    tmp_store = tempfile.mkdtemp(prefix="mabc-mcp-sgc-update-")
    tmp_graph_base = tempfile.mkdtemp(prefix="mabc-session-graph-worker-update-")

    # 현재 프로세스와 MCP 서버가 같은 대기열 경로를 보게 맞춘다.
    os.environ["MABC_SESSION_GRAPH_BASE"] = tmp_graph_base
    os.environ["SESSION_GRAPH_BASE"] = tmp_graph_base

    env = os.environ.copy()
    env["MABC_MCP_STORE"] = tmp_store
    env["MABC_MCP_TOKEN"] = "test-token"
    env["SESSION_GRAPH_BASE"] = tmp_graph_base
    env["MABC_SESSION_GRAPH_BASE"] = tmp_graph_base
    env["UPSTAGE_API_KEY"] = "test-key-not-used"

    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_server.main"],
        cwd=MCP_SERVER_DIR,
        env=env,
        encoding="utf-8",
        encoding_error_handler="strict",
    )

    sid = "session_kr_mcp_update_001"

    # 1차 제출 + MCP 서버 유지 상태에서 워커 처리
    client1 = Client(server=params, raise_exceptions=True)
    async with client1:
        first_text = "사용자: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다."
        submit1 = await call(client1, "submit_conversation", {
            "session_id": sid,
            "conversation_text": first_text,
            "context": {"source": "user_edit", "test": True, "round": 1},
        })
        print("1) 첫 제출 결과:")
        print(json.dumps(submit1, ensure_ascii=False, indent=2))
        req1 = submit1.get("session_graph_analysis", {}).get("request_id")
        print("2) 첫 분석 request_id:", req1)

        status1 = await call(client1, "get_session_graph_request", {"request_id": req1})
        print("3) 첫 요청 상태:")
        print(json.dumps(status1, ensure_ascii=False, indent=2))

        install_fake_openai()
        try:
            worker1 = run_worker_once(sid)
            print("\n4) 첫 처리 결과:")
            print(json.dumps(worker1, ensure_ascii=False, indent=2))
        finally:
            uninstall_fake_openai()

    # 2차 제출
    env2 = os.environ.copy()
    env2.update(env)
    params2 = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_server.main"],
        cwd=MCP_SERVER_DIR,
        env=env2,
        encoding="utf-8",
        encoding_error_handler="strict",
    )
    client2 = Client(server=params2, raise_exceptions=True)
    async with client2:
        second_text = "사용자: 배터리 성능이 더 떨어진 것 같아요. 이번에는 충전 횟수도 많아졌고요. 상담사: 배터리 진단 결과로 확인해 드리겠습니다."
        submit2 = await call(client2, "submit_conversation", {
            "session_id": sid,
            "conversation_text": second_text,
            "context": {"source": "user_edit", "test": True, "round": 2},
        })
        print("\n5) 두 번째 제출 결과:")
        print(json.dumps(submit2, ensure_ascii=False, indent=2))
        req2 = submit2.get("session_graph_analysis", {}).get("request_id")
        print("6) 두 번째 분석 request_id:", req2)

        status2 = await call(client2, "get_session_graph_request", {"request_id": req2})
        print("7) 두 번째 요청 상태:")
        print(json.dumps(status2, ensure_ascii=False, indent=2))

    install_fake_openai()
    try:
        worker2 = run_worker_once(sid)
        print("\n8) 두 번째 처리 결과:")
        print(json.dumps(worker2, ensure_ascii=False, indent=2))
    finally:
        uninstall_fake_openai()

    # 최종 상태 조회
    env3 = os.environ.copy()
    env3.update(env)
    params3 = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_server.main"],
        cwd=MCP_SERVER_DIR,
        env=env3,
        encoding="utf-8",
        encoding_error_handler="strict",
    )
    client3 = Client(server=params3, raise_exceptions=True)
    async with client3:
        final = await call(client3, "get_session_graph_request", {"request_id": req2})
        print("\n9) 최종 요청 상태:")
        print(json.dumps(final, ensure_ascii=False, indent=2))

    print("\n[완료] 같은 세션 갱신 + 실패 후 재시도 흐름 확인 끝")


if __name__ == "__main__":
    asyncio.run(main())
