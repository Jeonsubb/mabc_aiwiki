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
from mcp_server import analysis_store
from mcp_server import session_graph_bridge


# ------------------------------------------------------------------ 1) 대화 원본 보관

def tool_submit_conversation(session_id: str, conversation_text: str, context: dict) -> ToolResult:
    """사용자가 지정한 대화 구간+맥락을 위키 저장용으로 전달한다.

    MVP에서는 사용자가 명시적으로 "이 내용을 위키에 저장해줘"라고 요청할 때
    호출된다고 가정한다. 자동 전송/주기 전송은 MVP 범위 밖.

    저장 후에는 세션 그래프 분석 대기열에도 넣는다. 실제 추출/개념화/GraphML/연결 판단은
    별도 워커가 처리한다.
    """
    record = add_conversation(session_id, conversation_text, context)

    # 세션 그래프 분석 요청도 함께 넣는다. (백그라운드 처리)
    try:
        analysis_req = session_graph_bridge.enqueue_analysis(
            session_id=session_id,
            original_text=conversation_text,
            context=context,
            run_judgment=True,
        )
        analysis_req_id = analysis_req["id"]
        analysis_status = analysis_req["status"]
    except Exception as e:
        # 분석 대기열 등록 실패가 원문 저장을 깨지 않게 한다.
        analysis_req_id = None
        analysis_status = "enqueue_failed"
        import logging
        logging.getLogger("mabc-wiki-mcp").error("세션 그래프 분석 요청 등록 실패: %s", e)

    return ToolResult(
        ok=True,
        data={
            "conversation_id": record["id"],
            "stored_at": record["stored_at"],
            "session_graph_analysis": {
                "request_id": analysis_req_id,
                "status": analysis_status,
            },
        },
    )


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
    content: dict[str, Any],
    related: list[str] | None = None,
    tags: list[str] | None = None,
    source: str | None = None,
    source_ref: str | None = None,
    before_content: dict[str, Any] | None = None,
    after_content: dict[str, Any] | None = None,
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


# ------------------------------------------------------------------ 세션 그래프 분석 요청


def tool_submit_session_for_analysis(
    session_id: str,
    original_text: str,
    source: str,
    context: dict[str, Any] | None = None,
) -> ToolResult:
    """대화 원문을 세션 그래프 분석 큐에 등록한다.

    원문 저장과 분석 요청이 함께 처리된다. 실제 추출/개념화/GraphML/연결 판단은
    별도 워커가 처리하며, MCP 도구는 요청 등록과 임시 분석 응답合成까지만 담당한다.
    Solar 호출 없이 임시 응답을 쓰는 경우 analysis_store에서 합성 결과를 채운다.
    """
    if not session_id or not session_id.strip():
        return ToolResult(ok=False, error="session_id가 필요합니다")

    if not original_text or not original_text.strip():
        return ToolResult(ok=False, error="original_text가 필요합니다")

    if source not in {"user_edit", "ai_proposal", "agent"}:
        return ToolResult(ok=False, error=f"허용되지 않은 source 값: {source}. 허용: user_edit, ai_proposal, agent")

    ctx = context or {}
    rec = analysis_store.enqueue_session_analysis(
        session_id=session_id,
        original_text=original_text,
        source=source,
        context=ctx,
        skip_judgment=True,
    )

    # 임시 분석 응답: 실제 분석 전이라도 요청 등록 결과를 바로 반환
    return ToolResult(
        ok=True,
        data={
            "request_id": rec["id"],
            "session_id": rec["session_id"],
            "status": rec["status"],
            "queued_at": rec["created_at"],
            "note": "분석은 백그라운드 워커가 처리한다. Solar 미호출 모드에서는 임시 응답이 먼저 채워질 수 있다.",
        },
    )


def tool_sync_session_graph_analysis(
    request_id: str,
    analysis_result: dict[str, Any],
) -> ToolResult:
    """Solar 없이 임시 분석 응답을 기록한다.

    워커가 실제 분석을 수행했거나, 테스트 목적으로 합성 결과를 넣을 때 사용한다.
    """
    if not request_id or not request_id.strip():
        return ToolResult(ok=False, error="request_id가 필요합니다")

    if not isinstance(analysis_result, dict):
        return ToolResult(ok=False, error="analysis_result는 dict여야 합니다")

    rec = analysis_store.mark_analysis_synced(request_id, analysis_result)
    if not rec:
        return ToolResult(ok=False, error=f"요청 없음: {request_id}")

    return ToolResult(
        ok=True,
        data={
            "request_id": rec["id"],
            "session_id": rec["session_id"],
            "status": rec["status"],
            "synced_at": rec["finished_at"],
        },
    )


def tool_get_session_graph_request(request_id: str) -> ToolResult:
    """분석 요청 상태를 조회한다. (session_graph_bridge 기준)"""
    rec = session_graph_bridge.get_status(request_id)
    if not rec:
        return ToolResult(ok=False, error=f"요청 없음: {request_id}")
    return ToolResult(ok=True, data=_strip_internal(rec))


def tool_list_session_graph_requests(limit: int = 50) -> ToolResult:
    """분석 요청 목록을 조회한다. (session_graph_bridge 기준)"""
    if limit <= 0:
        limit = 50
    rows = session_graph_bridge.list_pending(limit)
    return ToolResult(ok=True, data=[_strip_internal(r) for r in rows])


def _strip_internal(rec: dict[str, Any]) -> dict[str, Any]:
    keep = {
        "id", "session_id", "source", "status", "created_at",
        "started_at", "finished_at", "analysis_result", "error",
    }
    out = {k: rec.get(k) for k in keep if k in rec}
    if "context" in rec:
        out["context"] = rec["context"]
    return out
