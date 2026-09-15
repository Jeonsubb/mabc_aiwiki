"""MCP 도구 정의.

PRD 4.1.1 흐름에 맞춰 Solar 기반 에이전트(사용자 대신)가 위키 보관/제안/승인/탐색용
도구를 호출할 수 있게 정의한다.

도구는 stdio MCP 서버로 노출되며, Hermes의 native-mcp 클라이언트에서
mcp_mabc_wiki_* 형태로 등록·호출된다.
"""

from __future__ import annotations

from mcp_server.store import (
    accept_proposal,
    add_conversation,
    create_conversation_record,
    create_proposal,
    get_proposal,
    get_wiki_node,
    list_conversations,
    list_proposals,
    list_wiki_nodes,
    reject_proposal,
    search_wiki_nodes,
    upsert_wiki_node,
)
from mcp_server.types import ToolResult


# ------------------------------------------------------------------ 1) 대화 원본 보관

def tool_submit_conversation(
    session_id: str,
    conversation_text: str | None = None,
    context: dict | None = None,
    messages: list[dict] | None = None,
    source: str | None = None,
) -> ToolResult:
    """사용자가 지정한 대화 구간+맥락을 위키 저장용으로 전달한다.

    MVP에서는 사용자가 명시적으로 '이 내용을 위키에 저장해줘'라고 요청할 때
    호출된다고 가정한다. 자동 전송/주기 전송은 MVP 범위 밖.

    입력은 두 방식 중 하나로 줄 수 있다.
      - messages 방식: 역할이 구분된 메시지 목록(role, content 필수 / record_id, timestamp 선택)
      - conversation_text 방식(기존 호환): 대화 원문 문자열
    두 입력이 함께 오면 아래 규칙을 따른다.
      - messages가 있으면 원문 구간의 1차 출처로 본다.
      - messages와 conversation_text가 함께 오면, messages를 역할 정보와 함께 이어 붙인
        재구성 텍스트와 conversation_text를 정규화해 비교한다.
      - 실질적으로 같으면 정상 처리, 다르면 오류로 처리한다(messages 우선).
      - messages가 없으면 conversation_text 방식으로 처리한다.

    주의:
      - role, content는 각 메시지의 필수 필드다. 하나라도 없으면 오류.
      - record_id, timestamp는 알 수 있는 값만 넣는다. 모르는 값을 만들어 넣지 않는다.
      - source는 전송 출처 구분용 선택 필드다.
    """
    context = context or {}
    return _tool_submit_conversation(
        session_id=session_id,
        conversation_text=conversation_text,
        context=context,
        messages=messages,
        source=source,
    )


def _tool_submit_conversation(
    session_id: str,
    conversation_text: str | None,
    context: dict,
    messages: list[dict] | None,
    source: str | None,
) -> ToolResult:
    """submit_conversation의 실제 입력 검증·정규화·저장 로직.

    messages 방식과 conversation_text 방식을 모두 다루고, 함께 들어올 때
    불일치를 검사한다.
    """

    def _normalize_text(t: str) -> str:
        return " ".join(t.split())

    # messages가 있으면 필수 필드 검증부터
    if messages is not None:
        for idx, m in enumerate(messages):
            if not isinstance(m, dict):
                return ToolResult(ok=False, error=f"messages[{idx}]는 dict여야 합니다")
            role = m.get("role")
            content = m.get("content")
            if role is None or content is None or not isinstance(role, str) or not isinstance(content, str):
                return ToolResult(ok=False, error=f"messages[{idx}]는 role과 content가 필수이며 문자열이어야 합니다")
            if not content:
                return ToolResult(ok=False, error=f"messages[{idx}]의 content는 비어 있을 수 없습니다")
        # 메시지에서 원문 재구성 텍스트 생성 (role + content)
        reconstructed = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in messages)

        if conversation_text is not None:
            # 둘 다 있음 -> 불일치 검사
            if _normalize_text(reconstructed) != _normalize_text(conversation_text):
                return ToolResult(
                    ok=False,
                    error=(
                        "messages와 conversation_text의 내용이 일치하지 않습니다. "
                        "messages를 우선하며, 차이를 확인 후 다시 요청하세요."
                    ),
                )
            # 실질적으로 같으면 conversation_text는 참조용으로만 두고, 원문 출처는 messages로 처리
            stored_text = reconstructed
        else:
            stored_text = reconstructed
        payload = {
            "session_id": session_id,
            "source": source,
            "messages": messages,
            "context": context,
            "conversation_text": stored_text,
        }
    else:
        # messages 없음 -> 기존 방식
        if conversation_text is None or not isinstance(conversation_text, str) or not conversation_text:
            return ToolResult(ok=False, error="conversation_text가 필요합니다(messages가 없을 때)")
        payload = {
            "session_id": session_id,
            "source": source,
            "messages": None,
            "context": context,
            "conversation_text": conversation_text,
        }

    record = create_conversation_record(payload)
    return ToolResult(ok=True, data={"conversation_id": record["id"], "stored_at": record["stored_at"]})


def tool_list_conversations(limit: int = 50) -> ToolResult:
    rows = list_conversations(limit)
    return ToolResult(ok=True, data=rows)


# ------------------------------------------------------------------ 2) 위키 생성/변경 제안

def tool_create_proposal(
    conversation_id: str,
    title: str,
    kind: str,
    content: dict,
    rationale: str,
    status: str = "pending",
    target_node_id: str | None = None,
) -> ToolResult:
    """Solar + ai-wiki 스킬로 만든 위키 생성/변경/추가/분리/연결 제안을 저장한다.

    content가 최종 위키 내용의 기준이다.
    before_after는 서버가 content와 target_node_id를 바탕으로 자동 생성한다.

    change는 target_node_id가 필수이며, 해당 위키가 없으면 제안 생성이 실패한다.
    """
    try:
        record = create_proposal(
            conversation_id, title, kind, content, rationale, status, target_node_id
        )
        return ToolResult(ok=True, data={"proposal_id": record["id"], "status": record["status"]})
    except ValueError as e:
        return ToolResult(ok=False, error=str(e))


def tool_list_proposals(status: str | None = None, limit: int = 100) -> ToolResult:
    rows = list_proposals(status, limit)
    return ToolResult(ok=True, data=rows)


def tool_get_proposal(proposal_id: str) -> ToolResult:
    p = get_proposal(proposal_id)
    if not p:
        return ToolResult(ok=False, error=f"제안 없음: {proposal_id}")
    return ToolResult(ok=True, data=p)


# ------------------------------------------------------------------ 3) 제안 승인/기각

def tool_accept_proposal(proposal_id: str) -> ToolResult:
    """사용자가 제안을 승인한다. 승인 전에는 변경 전/후를 먼저 확인해야 한다."""
    try:
        p = accept_proposal(proposal_id)
        if not p:
            return ToolResult(ok=False, error=f"제안 없음: {proposal_id}")
        return ToolResult(ok=True, data={"proposal_id": p["id"], "status": p["status"], "accepted_at": p["accepted_at"]})
    except ValueError as e:
        return ToolResult(ok=False, error=str(e))


def tool_reject_proposal(proposal_id: str) -> ToolResult:
    """사용자가 제안을 기각한다."""
    try:
        p = reject_proposal(proposal_id)
        if not p:
            return ToolResult(ok=False, error=f"제안 없음: {proposal_id}")
        return ToolResult(ok=True, data={"proposal_id": p["id"], "status": p["status"], "rejected_at": p["rejected_at"]})
    except ValueError as e:
        return ToolResult(ok=False, error=str(e))


# ------------------------------------------------------------------ 4) 위키 읽기/탐색/검색

def tool_list_wiki_nodes(limit: int = 100) -> ToolResult:
    rows = list_wiki_nodes(limit)
    return ToolResult(ok=True, data=rows)


def tool_get_wiki_node(node_id: str) -> ToolResult:
    n = get_wiki_node(node_id)
    if not n:
        return ToolResult(ok=False, error=f"위키 노드 없음: {node_id}")
    return ToolResult(ok=True, data=n)


def tool_search_wiki(query: str, limit: int = 20) -> ToolResult:
    rows = search_wiki_nodes(query, limit)
    return ToolResult(ok=True, data=rows)


def tool_upsert_wiki_node(
    node_id: str | None,
    title: str,
    summary: str,
    content: dict,
    related: list[str] | None = None,
    tags: list[str] | None = None,
    source: str | None = None,
    source_ref: str | None = None,
    before_content: dict | None = None,
    after_content: dict | None = None,
) -> ToolResult:
    """위키 노드를 생성·갱신한다.

    node_id가 있으면 갱신(이전 내용 history에 보존), 없으면 신규 생성.
    source: 생성 주체 — 필수 파라미터.
        허용 값:
          - "ai_proposal": accept_proposal을 통해서만 사용 (도구 함수에서 차단됨)
          - "user_edit": 사용자 직접 편집 도구 경로 (실제 사용자 편집 여부는 상위 계층에서 검증)
        source 생략 불가 — 생략 시 오류.
    source_ref: 출처 참조 ID (제안 ID, 사용자 세션 ID 등)
    """
    # source 필수화
    if source is None:
        return ToolResult(ok=False, error="source 파라미터가 필요합니다")
    
    # source 허용 값 검증
    ALLOWED_SOURCES = {"ai_proposal", "user_edit"}
    if source not in ALLOWED_SOURCES:
        return ToolResult(ok=False, error=f"허용되지 않은 source 값: {source}. 허용: {', '.join(sorted(ALLOWED_SOURCES))}")
    
    # AI 제안 출처는 accept_proposal을 통해서만 허용 (승인 우회 차단)
    if source == "ai_proposal":
        return ToolResult(ok=False, error="source='ai_proposal'는 accept_proposal을 통해서만 사용할 수 있습니다")
    
    record = upsert_wiki_node(
        node_id, title, summary, content, related, tags,
        source=source, source_ref=source_ref,
        before_content=before_content, after_content=after_content,
    )
    return ToolResult(ok=True, data=record)
