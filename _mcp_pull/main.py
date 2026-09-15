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


# ------------------------------------------------------------------ 서버 실행

def main() -> None:
    """stdio MCP 서버를 실행한다.

    uv run mabc-wiki-mcp 또는 uvx로 실행 가능.
    """
    logger.info("mabc-wiki-mcp stdio 서버 시작 (store dir: %s)", store.STORE_DIR)
    asyncio.run(_run_server())


async def _run_server() -> None:
    await server.run_stdio_async()


if __name__ == "__main__":
    main()
