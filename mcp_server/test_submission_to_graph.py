"""MCP submit_conversation → 세션 그래프 분석 대기열 → 워커 처리 흐름 확인.

1) MCP submit_conversation 호출
2) 세션 그래프 분석 요청 등록 여부 확인
3) 워커가 pending을 꺼내 전체 파이프라인 실행(가짜 LLM 사용)
4) get_session_graph로 저장/조회 확인
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

MCP_SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mcp_server"))
if MCP_SERVER_DIR not in sys.path:
    sys.path.insert(0, MCP_SERVER_DIR)

from mcp import Client
from mcp.client.stdio import StdioServerParameters


def _tool_text(result) -> str:
    """CallToolResult에서 첫 텍스트 콘텐츠만 추출한다."""
    for block in (getattr(result, "content", []) or []):
        kind = getattr(block, "type", None)
        if kind == "text":
            return getattr(block, "text", "") or ""
    return ""


def _unwrap_mcp_result(result) -> dict:
    """MCP 도구가 _fmt_result 스타일로 반환한 값을 한 번 풀어 dict로 만든다.

    MCP 프레임워크가 content 배열을 다시 JSON 텍스트로 감싼 경우,
    content[0].text 안에 실제 반환 JSON이 들어 있을 수 있다.
    """
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


async def main() -> None:
    tmp_store = tempfile.mkdtemp(prefix="mabc-mcp-sgc-test-")
    tmp_graph_base = tempfile.mkdtemp(prefix="mabc-session-graph-worker-")

    env = os.environ.copy()
    env["MABC_MCP_STORE"] = tmp_store
    env["MABC_MCP_TOKEN"] = "test-token"
    env["SESSION_GRAPH_BASE"] = tmp_graph_base
    env["UPSTAGE_API_KEY"] = "test-key-not-used"

    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_server.main"],
        cwd=MCP_SERVER_DIR,
        env=env,
        encoding="utf-8",
        encoding_error_handler="strict",
    )

    client = Client(server=params, raise_exceptions=True)

    async with client:
        sid = "session_kr_mcp_bridge_001"
        text = "사용자: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다."

        submit_result = await client.call_tool(
            "submit_conversation",
            {
                "session_id": sid,
                "conversation_text": text,
                "context": {"source": "user_edit", "test": True},
            },
        )
        submit = _unwrap_mcp_result(submit_result)
        print("1) submit_conversation 결과:")
        print(json.dumps(submit, ensure_ascii=False, indent=2))

        sga = submit.get("session_graph_analysis") or {}
        req_id = sga.get("request_id")
        print("2) 세션 그래프 분석 request_id:", req_id)

        if not req_id:
            print("[중단] 세션 그래프 분석 요청이 등록되지 않았습니다.")
            return

        status0_result = await client.call_tool(
            "get_session_graph_request",
            {"request_id": req_id},
        )
        status0 = _unwrap_mcp_result(status0_result)
        print("3) 초기 분석 요청 상태:")
        print(json.dumps(status0, ensure_ascii=False, indent=2))

    # MCP 연결을 닫은 뒤 워커가 처리
    print(f"\n[worker 입력 대기열 처리용 base={tmp_graph_base}]")

    root = os.path.abspath(os.path.join(MCP_SERVER_DIR, ".."))
    sg_dir = os.path.abspath(os.path.join(root, "session-graph"))
    if root not in sys.path:
        sys.path.insert(0, root)
    if sg_dir not in sys.path:
        sys.path.insert(0, sg_dir)

    # 테스트 전용 가짜 LLM 설치 (Solar 호출 대신 기본 응답 사용)
    from mcp_server.test_fake_llm import install_fake_openai, uninstall_fake_openai
    install_fake_openai()

    try:
        from session_graph_api import ingest_session, get_session_graph
        from mcp_server.session_graph_bridge import dequeue_one, mark_done

        item = dequeue_one()
        if item is None:
            print("[worker] pending 없음")
            worker_res = {"status": "no_pending"}
        else:
            req_id = item["id"]
            session_id = item["session_id"]
            original_text = item["original_text"]

            result = ingest_session(
                session_id=session_id,
                original_text=original_text,
                run_judgment=item.get("run_judgment", True),
                force_refresh=False,
            )

            conn_file = result.get("connections_file")
            conn_count = 0
            if conn_file and os.path.exists(conn_file):
                with open(conn_file, encoding="utf-8") as f:
                    payload = json.load(f)
                conn_count = len(payload.get("connections", []))

            mark_done(req_id, result={"connection_file": conn_file, "connections": conn_count})

            graph = get_session_graph(session_id_filter=session_id)
            node = next((n for n in graph["nodes"] if n["id"] == session_id), None)

            worker_res = {
                "req_id": req_id,
                "session_id": session_id,
                "status": "ok",
                "has_extraction": bool(node.get("has_extraction")) if node else False,
                "has_concept_graphml": bool(node.get("has_concept_graphml")) if node else False,
                "graphml_path": node.get("graphml_path") if node else None,
                "connections_count": conn_count,
                "ingest_summary": {
                    k: result.get(k) for k in ("extraction", "conceptualization", "analysis_status", "connections_file")
                },
            }
            print("\n4) 워커 처리 결과:")
            print(json.dumps(worker_res, ensure_ascii=False, indent=2))
    finally:
        uninstall_fake_openai()

    # 조회 도구 재연결로 최종 상태 확인
    env2 = os.environ.copy()
    env2["MABC_MCP_STORE"] = tmp_store
    env2["MABC_MCP_TOKEN"] = "test-token"
    env2["SESSION_GRAPH_BASE"] = tmp_graph_base
    env2["UPSTAGE_API_KEY"] = "test-key-not-used"

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
        final_req_result = await client2.call_tool(
            "get_session_graph_request",
            {"request_id": req_id},
        )
        final_req = _unwrap_mcp_result(final_req_result)
        print("\n5) 최종 분석 요청 상태:")
        print(json.dumps(final_req, ensure_ascii=False, indent=2))

        # 세션 그래프 상태가 MCP 저장소와 별개이므로, MCP 도구에는 아직 그래프 조회 도구가 없음.
        # 대신 워커 결과의 has_concept_graphml 등으로 연결 성공 여부를 확인한다.
        print("\n[완료] MCP submit_conversation → 세션 그래프 분석 대기열 → 워커 처리 흐름 확인 끝")


if __name__ == "__main__":
    asyncio.run(main())
