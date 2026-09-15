"""mabc-wiki-mcp stdio 서버 엔트리포인트.

Hermes Agent의 native-mcp 클라이언트가 이 서버를 subprocess로 띄우고
stdin/stdout으로 MCP 메시지를 주고받는다.

제공하는 도구:
- submit_conversation: 대화 원본 보관
- list_conversations: 보관된 대화 목록 조회
- create_proposal: 위키 생성/변경 제안 저장
- list_proposals: 제안 목록 조회 (status 필터 가능)
- get_proposal: 제안 상세 + 변경 전/후 미리보기 조회
- list_wiki_nodes: 위키 노드 목록 조회 (조회 전용)
- get_wiki_node: 위키 노드 상세 조회 (조회 전용)
- search_wiki: 위키 노드 텍스트 검색 (조회 전용)

승인·기각·위키 생성/수정은 MCP 도구에서 제외하고,
웹 UI API(/Users/kwon/Desktop/etc/mabc-mcp_server/mcp_server/web_api.py)에서 처리.
"""

from __future__ import annotations

import logging
import sys
import asyncio
import json

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.stdio import stdio_server

from mcp_server import store
from mcp_server import tools
from mcp_server.types import ToolResult

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("mabc-wiki-mcp")

server = MCPServer("mabc-wiki-mcp")


def _fmt_result(result: ToolResult) -> dict:
    if result.ok:
        return {"content": [{"type": "text", "text": json.dumps(result.data, ensure_ascii=False)}]}
    raise ToolError(f"오류: {result.error}")


# ------------------------------------------------------------------ 대화 원본 보관

@server.tool()
async def submit_conversation(
    session_id: str,
    conversation_text: str | None = None,
    context: dict | None = None,
    messages: list[dict] | None = None,
    source: str | None = None,
) -> dict:
    """[위키 저장용] 사용자가 지정한 대화 구간+맥락을 원본 보관 영역에 전달한다.

    입력은 두 방식 중 하나로 줄 수 있다.
      - messages: 역할이 구분된 메시지 목록(role, content 필수 / record_id, timestamp 선택)
      - conversation_text: 기존 호환용 대화 원문 문자열

    둘 다 제공하면 messages를 원문 구간의 1차 출처로 보고, messages를 역할 정보와
    함께 이어 붙인 재구성 텍스트와 conversation_text가 실질적으로 같은지 검사한다.
    다르면 오류로 처리하고(messages 우선), 같으면 정상 저장한다.

    messages가 있으면 각 메시지의 role과 content가 필수다. 하나라도 없거나 비어 있으면
    도구 오류로 처리한다. record_id, timestamp는 알 수 있는 값만 넣는다.

    MVP에서는 사용자가 명시적으로 위키 저장 요청을 했을 때만 호출된다고 가정한다.
    자동 전송/주기 전송/대화 종료 자동 위키화는 MVP 범위 밖.
    """
    logger.info(
        "submit_conversation session=%s messages=%s conversation_text=%s source=%s",
        session_id,
        (len(messages) if messages is not None else 0),
        (len(conversation_text) if conversation_text is not None else 0),
        source,
    )
    return _fmt_result(
        tools.tool_submit_conversation(
            session_id=session_id,
            conversation_text=conversation_text,
            context=context,
            messages=messages,
            source=source,
        )
    )


@server.tool()
async def list_conversations(limit: int = 50) -> dict:
    """원본 보관 영역에 저장된 대화 기록 목록을 조회한다."""
    return _fmt_result(tools.tool_list_conversations(limit))


# ------------------------------------------------------------------ 위키 생성/변경 제안

@server.tool()
async def create_proposal(
    conversation_id: str,
    title: str,
    kind: str,
    content: dict,
    rationale: str,
    status: str = "pending",
    target_node_id: str = "",
) -> dict:
    """Solar + ai-wiki 스킬로 만든 위키 생성/변경/추가/분리/연결 제안을 저장한다.

    kind: add | change | split | merge | connect | relation

    content가 최종 위키 내용의 기준이다.
    before_after는 서버가 content와 target_node_id를 바탕으로 자동 생성한다.

    change는 target_node_id가 필수이며, 해당 위키가 없으면 제안 생성이 실패한다.
    실제 위키 반영은 사용자 승인 구간에서 이뤄진다.
    """
    VALID_KINDS = {"add", "change", "split", "merge", "connect", "relation"}
    if kind not in VALID_KINDS:
        raise ToolError(f"유효하지 않은 kind: {kind}. 허용 값: {', '.join(sorted(VALID_KINDS))}")
    if kind == "change" and (not target_node_id or not target_node_id.strip()):
        raise ToolError("change 제안은 target_node_id가 필요합니다")
    target_node_id_final = target_node_id if target_node_id and target_node_id.strip() else None
    logger.info("create_proposal kind=%s title=%s target_node_id=%s", kind, title, target_node_id_final)
    return _fmt_result(
        tools.tool_create_proposal(conversation_id, title, kind, content, rationale, status, target_node_id_final)
    )


@server.tool()
async def list_proposals(status: str | None = None, limit: int = 100) -> dict:
    """제안 목록을 조회한다. status로 pending/accepted/rejected 필터 가능."""
    return _fmt_result(tools.tool_list_proposals(status, limit))


@server.tool()
async def get_proposal(proposal_id: str) -> dict:
    """제안 상세 + 변경 전/후 미리보기를 조회한다."""
    return _fmt_result(tools.tool_get_proposal(proposal_id))


# ------------------------------------------------------------------ 위키 조회 (생성/수정은 MCP에서 제외, 웹 UI API에서 처리)

@server.tool()
async def list_wiki_nodes(limit: int = 100) -> dict:
    """위키 노드 목록을 최신순으로 조회한다. (조회 전용)"""
    return _fmt_result(tools.tool_list_wiki_nodes(limit))


@server.tool()
async def get_wiki_node(node_id: str) -> dict:
    """위키 노드 하나를 조회한다. (조회 전용)"""
    return _fmt_result(tools.tool_get_wiki_node(node_id))


@server.tool()
async def search_wiki(query: str, limit: int = 20) -> dict:
    """위키 노드를 간단한 텍스트 검색으로 찾는다. (조회 전용)

    실제 서비스에서는 임베딩/벡터 검색을 붙여야 한다(MVP 이후).
    """
    return _fmt_result(tools.tool_search_wiki(query, limit))


# ------------------------------------------------------------------ 세션 그래프 분석 요청


@server.tool()
async def submit_session_for_analysis(
    session_id: str,
    original_text: str,
    source: str,
    context: dict | None = None,
) -> dict:
    """대화 원문을 세션 그래프 분석 큐에 등록한다.

    원문 저장과 분석 요청이 함께 처리된다. 실제 추출/개념화/GraphML/연결 판단은
    별도 워커가 처리하며, MCP 도구는 요청 등록까지만 담당한다.
    Solar 미호출 모드에서는 analysis_store를 통해 임시 분석 응답을 나중에 채울 수 있다.
    """
    return _fmt_result(
        tools.tool_submit_session_for_analysis(session_id, original_text, source, context)
    )


@server.tool()
async def sync_session_graph_analysis(
    request_id: str,
    analysis_result: dict,
) -> dict:
    """Solar 없이 임시 분석 응답을 기록한다.

    워커가 실제 분석을 수행했거나, 테스트 목적으로 합성 결과를 넣을 때 사용한다.
    """
    return _fmt_result(
        tools.tool_sync_session_graph_analysis(request_id, analysis_result)
    )


@server.tool()
async def get_session_graph_request(request_id: str) -> dict:
    """분석 요청 상태를 조회한다."""
    return _fmt_result(tools.tool_get_session_graph_request(request_id))


@server.tool()
async def list_session_graph_requests(limit: int = 50) -> dict:
    """분석 요청 목록을 조회한다."""
    return _fmt_result(tools.tool_list_session_graph_requests(limit))


# ------------------------------------------------------------------ 서버 실행

import argparse
import os
import secrets

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from mcp.server.transport_security import TransportSecuritySettings


def _get_token() -> str:
    token = os.environ.get("MABC_MCP_TOKEN", "")
    return token.strip()


class _BearerAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Starlette, expected_token: str) -> None:
        super().__init__(app)
        self._expected_token = expected_token

    async def dispatch(self, request: Request, call_next) -> Response:
        auth_header = request.headers.get("authorization", "")
        if not auth_header.lower().startswith("bearer "):
            return Response(status_code=401)
        token = auth_header.split(maxsplit=1)[1] if len(auth_header.split(maxsplit=1)) > 1 else ""
        if not secrets.compare_digest(token, self._expected_token):
            return Response(status_code=401)
        return await call_next(request)


def main() -> None:
    """MCP 서버를 실행한다.

    기본: 기존 stdio 방식.
    --http: Streamable HTTP 방식 (127.0.0.1:8766, /mcp).
    """
    parser = argparse.ArgumentParser(prog="mabc-wiki-mcp")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Streamable HTTP 서버로 실행 (127.0.0.1:8766, path=/mcp)",
    )
    args = parser.parse_args()

    if args.http:
        logger.info(
            "mabc-wiki-mcp Streamable HTTP 서버 시작 (host=127.0.0.1, port=8766, path=/mcp, store dir: %s)",
            store.STORE_DIR,
        )
        asyncio.run(_run_http_server())
    else:
        logger.info("mabc-wiki-mcp stdio 서버 시작 (store dir: %s)", store.STORE_DIR)
        asyncio.run(_run_stdio_server())


async def _run_stdio_server() -> None:
    await server.run_stdio_async()


async def _run_http_server() -> None:
    token = _get_token()
    if not token:
        logger.error(
            "MABC_MCP_TOKEN이 설정되지 않아 Streamable HTTP 서버를 시작할 수 없습니다"
        )
        raise SystemExit(1)

    transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[
            "127.0.0.1:8766",
            "kwon-macbookpro.taila8950e.ts.net",
            "kwon-macbookpro.taila8950e.ts.net:443",
        ],
    )

    starlette_app = server.streamable_http_app(
        streamable_http_path="/mcp",
        host="127.0.0.1",
        transport_security=transport_security,
    )
    app = _BearerAuthMiddleware(starlette_app, token)

    import uvicorn

    config = uvicorn.Config(app, host="127.0.0.1", port=8766, log_level=logging.INFO)
    uvicorn_server = uvicorn.Server(config)
    await uvicorn_server.serve()


if __name__ == "__main__":
    main()
