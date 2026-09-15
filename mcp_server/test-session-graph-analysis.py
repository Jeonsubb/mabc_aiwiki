"""MCP 도구 호출로 세션 그래프 분석 시나리오를 확인한다. (Solar 미호출)

1) 새 세션 입력
2) 같은 세션 갱신
3) 그래프 조회 목적(분석 상태 조회)로 현재 결과 확인
4) 실패 후 재시도: 임시 분석 합성 결과 채워서 상태 복원 확인
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

MCP_SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mcp_server"))
sys.path.insert(0, MCP_SERVER_DIR)

from mcp import Client
from mcp.client.stdio import StdioServerParameters


def _tool_call(client: Client, name: str, **kwargs):
    return client.call_tool(name, kwargs)


async def main() -> None:
    tmp_store = tempfile.mkdtemp(prefix="mabc-mcp-session-graph-test-")
    env = os.environ.copy()
    env["MABC_MCP_STORE"] = tmp_store
    env["MABC_MCP_TOKEN"] = "test-token"

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
        # 1) 새 세션 입력 (MCP 제출 + 분석 요청 등록)
        sid = "session_kr_mcp_001"
        text1 = "사용자: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다."
        submit1 = await _tool_call(
            client,
            "submit_session_for_analysis",
            session_id=sid,
            original_text=text1,
            source="user_edit",
            context={"source": "cli-test"},
        )
        print("1) 신규 제출:", json.dumps(submit1, ensure_ascii=False))

        request_id = submit1["request_id"]
        assert request_id, "request_id 없음"

        # 2) 같은 세션 갱신
        text2 = "사용자: 배터리 성능이 더 심해져서 오전에 이미 꺼졌어요. 상담사: 방전 이력과 설정부터 확인하겠습니다."
        submit2 = await _tool_call(
            client,
            "submit_session_for_analysis",
            session_id=sid,
            original_text=text2,
            source="user_edit",
            context={"source": "cli-test"},
        )
        print("2) 갱신 제출:", json.dumps(submit2, ensure_ascii=False))

        # 3) 그래프 조회 목적: 분석 요청 상태 조회 (아직 분석 결과 없음)
        req_status = await _tool_call(client, "get_session_graph_request", request_id=request_id)
        print("3) 분석 요청 상태(초기):", json.dumps(req_status, ensure_ascii=False))

        # 4) 실패 후 재시도: 임시 분석 응답을 채움
        #    분석 결과는 MCP store에 남는 세션 그래프 요청 레코드에 합성 결과로 직접 기록
        analysis_result = {
            "session_id": sid,
            "status": "ok",
            "analysis_mode": "temp_synthetic",
            "has_extraction": True,
            "has_concept_graphml": True,
            "graphml_path": "/tmp/session_graph_runtime_placeholder/kg_with_concept.graphml",
            "edges": 3,
            "note": "Solar 미호출 임시 응답. 실제 워커 결과로 대체돼야 함.",
        }
        sync1 = await _tool_call(
            client,
            "sync_session_graph_analysis",
            request_id=request_id,
            analysis_result=analysis_result,
        )
        print("4) 임시 분석 응답 등록:", json.dumps(sync1, ensure_ascii=False))

        # 재시도 후 상태 확인
        req_status2 = await _tool_call(client, "get_session_graph_request", request_id=request_id)
        print("5) 분석 요청 상태(재시도 후):", json.dumps(req_status2, ensure_ascii=False))

        # 목록 조회
        list_res = await _tool_call(client, "list_session_graph_requests", limit=5)
        print("6) 분석 요청 목록:", json.dumps(list_res, ensure_ascii=False))

    print("[done] 시나리오 확인 완료")


if __name__ == "__main__":
    asyncio.run(main())
