"""세션 그래프 분석 워커(테스트용).

MCP submit_conversation이 남긴 분석 대기열을 꺼내,
세션 그래프 엔진(session_graph_api.ingest_session)을 실행한다.

테스트 환경에서는 가짜 LLM을 사용해 Solar 호출을 하지 않는다.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

MCP_DIR = os.path.abspath(os.path.dirname(__file__))
if MCP_DIR not in sys.path:
    sys.path.insert(0, MCP_DIR)

from mcp_server.session_graph_bridge import dequeue_one, mark_done, get_status, list_pending
import session_graph_api
from test_fake_llm import install_fake_openai, uninstall_fake_openai


def run_one(base: str, fake: bool, response_template: str | None):
    os.environ["SESSION_GRAPH_BASE"] = base
    os.environ["UPSTAGE_API_KEY"] = "test-key-not-used"

    if fake:
        install_fake_openai(response_template)

    try:
        item = dequeue_one()
        if item is None:
            return {"status": "no_pending"}

        req_id = item["id"]
        session_id = item["session_id"]
        original_text = item["original_text"]
        user_id = item.get("userId") or item.get("user_id") or ""

        # ingest_session은 추출/개념화/GraphML/연결을 모두 실행한다.
        # Solar 호출이 있는 부분은 가짜 LLM이 대체한다.
        result = session_graph_api.ingest_session(
            session_id=session_id,
            original_text=original_text,
            run_judgment=item.get("run_judgment", True),
            force_refresh=False,
            user_id=user_id,
        )

        analysis_status = result.get("analysis_status", "ok")
        conn_file = result.get("connections_file")
        conn_count = 0
        if conn_file and os.path.exists(conn_file):
            import json
            with open(conn_file, encoding="utf-8") as f:
                payload = json.load(f)
            conn_count = len(payload.get("connections", []))

        if analysis_status == "fail":
            mark_done(req_id, result=result, error="분석 실패(추출/개념/GraphML)")
        else:
            mark_done(req_id, result={"connection_file": conn_file, "connections": conn_count})

        graph = session_graph_api.get_session_graph(session_id_filter=session_id)
        node = next((n for n in graph["nodes"] if n["id"] == session_id), None)

        return {
            "req_id": req_id,
            "session_id": session_id,
            "status": "failed" if analysis_status == "fail" else "ok",
            "has_extraction": bool(node.get("has_extraction")) if node else False,
            "has_concept_graphml": bool(node.get("has_concept_graphml")) if node else False,
            "graphml_path": node.get("graphml_path") if node else None,
            "connections_count": conn_count,
            "ingest_summary": {
                k: result.get(k) for k in ("extraction", "conceptualization", "analysis_status", "connections_file")
            },
        }
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        if item is not None:
            mark_done(item["id"], error=str(e))
        return {"status": "error", "error": str(e), "traceback": tb}
    finally:
        if fake:
            uninstall_fake_openai()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="/tmp/mabc_session_graph_worker")
    parser.add_argument("--fake", action="store_true", help="Solar 호출 대신 가짜 응답 사용")
    parser.add_argument("--response", default=None, help="가짜 응답 템플릿(JSON 문자열)")
    parser.add_argument("--loop", action="store_true", help="pending이 없을 때까지 대기 반복")
    args = parser.parse_args()

    print(f"[worker] base={args.base} fake={args.fake}")
    while True:
        res = run_one(args.base, args.fake, args.response)
        print("---")
        for k, v in res.items():
            if k == "ingest_summary":
                print(f"{k}:")
                for kk, vv in v.items():
                    print(f"  {kk}: {vv}")
            else:
                print(f"{k}: {v}")
        print("---")

        if not args.loop:
            break
        if res.get("status") == "no_pending":
            print("[worker] pending 없음, 종료")
            break
        time.sleep(1)


if __name__ == "__main__":
    main()
