"""파일 기반 저장소 (MVP 단계 스텁).

실제 서비스화되면 웹 백엔드/DB로 교체한다.
지금은 대화 원본 보관, 제안, 위키 노드를 JSON 파일로 관리한다.
"""

from __future__ import annotations

import json
import os
import copy
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_DIR = Path(os.environ.get("MABC_MCP_STORE", os.path.expanduser("~/.mabc-mcp-store")))
CONVERSATIONS_FILE = STORE_DIR / "conversations.json"
PROPOSALS_FILE = STORE_DIR / "proposals.json"
WIKI_NODES_FILE = STORE_DIR / "wiki_nodes.json"

def _ensure() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    for path, default in [
        (CONVERSATIONS_FILE, []),
        (PROPOSALS_FILE, []),
        (WIKI_NODES_FILE, []),
    ]:
        if not path.exists():
            path.write_text(json.dumps(default, ensure_ascii=False, indent=2))

def _read(path: Path) -> list[dict[str, Any]]:
    _ensure()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def _write(path: Path, data: list[dict[str, Any]]) -> None:
    _ensure()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ------------------------------------------------------------------ 대화 원본 보관

def create_conversation_record(
    payload: dict[str, Any],
) -> dict[str, Any]:
    """submit_conversation(payload)로부터 원본 보관 레코드 하나를 저장한다.

    payload는 세션/출처/메시지/보충맥락/원문 텍스트 등을 담는다.
    messages 또는 conversation_text 중 하나 이상이 원문을 구성한다.
    """
    _ensure()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": payload.get("session_id"),
        "source": payload.get("source"),
        "messages": payload.get("messages"),
        "context": payload.get("context"),
        "conversation_text": payload.get("conversation_text"),
        "stored_at": datetime.now(timezone.utc).isoformat(),
    }
    data = _read(CONVERSATIONS_FILE)
    data.append(record)
    _write(CONVERSATIONS_FILE, data)
    return record


def add_conversation(
    session_id: str,
    conversation_text: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """사용자가 지정한 대화 구간+맥락을 원본 보관 영역에 저장한다.

    PRD 4.1.1 (1)~(3)에 대응: MCP 도구로 전달받은 대화 내용(구간+맥락)을
    먼저 보관한다. 실제 위키로 바로 반영하지 않고 보관 후 후보 생성 입력으로 쓴다.
    """
    _ensure()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "stored_at": datetime.now(timezone.utc).isoformat(),
        "context": context,
        "conversation_text": conversation_text,
    }
    data = _read(CONVERSATIONS_FILE)
    data.append(record)
    _write(CONVERSATIONS_FILE, data)
    return record

def list_conversations(limit: int = 50) -> list[dict[str, Any]]:
    data = _read(CONVERSATIONS_FILE)
    return data[-limit:]

# ------------------------------------------------------------------ 제안(proposal)

def create_proposal(
    conversation_id: str,
    title: str,
    kind: str,
    content: dict[str, Any],
    rationale: str,
    status: str = "pending",
    target_node_id: str | None = None,
) -> dict[str, Any]:
    """위키 생성/변경/추가/분리/연결 제안을 저장한다.

    content가 최종 위키 내용의 기준이다.
    before_after는 서버가 content와 target_node_id를 바탕으로 자동 생성한다.

    kind:
      - add: 신규 위키 생성. before={"exists": false}, after=content로 자동 구성.
      - change: 기존 위키 수정. target_node_id가 필수이며, 해당 위키 조회 결과를
        before로, content를 after로 자동 구성한다.
      - split, merge, connect, relation: 아직 제안 생성만 가능, 위키 반영은 미지원.
    status: 'pending'만 허용 (MVP)
    target_node_id: change일 때 수정할 기존 위키 노드 ID. add에서는 무시된다.
    """
    _ensure()

    # conversation_id 존재 검증
    conv = get_conversation(conversation_id)
    if not conv:
        raise ValueError(f"존재하지 않는 conversation_id: {conversation_id}")

    # status는 항상 pending으로 고정 (MVP)
    status = "pending"

    # content 허용 키 검증
    ALLOWED_CONTENT_KEYS = {"title", "summary", "body", "tags", "related"}
    extra_keys = set(content.keys()) - ALLOWED_CONTENT_KEYS
    if extra_keys:
        raise ValueError(f"content에 허용되지 않은 키가 있습니다: {', '.join(sorted(extra_keys))}")

    # kind별 before/after 자동 구성
    if kind == "add":
        before = {"exists": False}
        after = content
    elif kind == "change":
        if not target_node_id:
            raise ValueError("change 제안은 target_node_id가 필요합니다")
        existing = get_wiki_node(target_node_id)
        if not existing:
            raise ValueError(f"변경 대상 위키가 없습니다: {target_node_id}")
        before = {
            "id": existing.get("id"),
            "title": existing.get("title"),
            "summary": existing.get("summary"),
            "content": existing.get("content"),
            "tags": existing.get("tags", []),
            "related": existing.get("related", []),
        }
        after = content
    else:
        # split, merge, connect, relation 등은 아직 create_proposal 저장만 허용
        before = {}
        after = content

    record = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "title": title,
        "kind": kind,
        "content": content,
        "before_after": {"before": before, "after": after},
        "rationale": rationale,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "accepted_at": None,
        "rejected_at": None,
        "target_node_id": target_node_id,
    }
    data = _read(PROPOSALS_FILE)
    data.append(record)
    _write(PROPOSALS_FILE, data)
    return record

def list_proposals(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    data = _read(PROPOSALS_FILE)
    if status:
        data = [p for p in data if p.get("status") == status]
    # 최신순
    data = sorted(data, key=lambda x: x.get("created_at", ""), reverse=True)
    return data[:limit]

def get_proposal(proposal_id: str) -> dict[str, Any] | None:
    for p in _read(PROPOSALS_FILE):
        if p.get("id") == proposal_id:
            return p
    return None

def get_conversation(conversation_id: str) -> dict[str, Any] | None:
    for c in _read(CONVERSATIONS_FILE):
        if c.get("id") == conversation_id:
            return c
    return None

def accept_proposal(proposal_id: str) -> dict[str, Any] | None:
    """제안을 승인 상태로 변경 (위키 작업 없음)."""
    data = _read(PROPOSALS_FILE)
    for p in data:
        if p.get("id") == proposal_id:
            current_status = p.get("status", "pending")
            if current_status == "accepted":
                raise ValueError(f"이미 승인된 제안입니다: {proposal_id}")
            if current_status == "rejected":
                raise ValueError(f"기각된 제안은 다시 승인할 수 없습니다: {proposal_id}")
            p["status"] = "accepted"
            p["accepted_at"] = datetime.now(timezone.utc).isoformat()
            _write(PROPOSALS_FILE, data)
            return p
    return None

def reject_proposal(proposal_id: str) -> dict[str, Any] | None:
    """제안을 기각 상태로 변경."""
    data = _read(PROPOSALS_FILE)
    for p in data:
        if p.get("id") == proposal_id:
            current_status = p.get("status", "pending")
            if current_status == "rejected":
                raise ValueError(f"이미 기각된 제안입니다: {proposal_id}")
            if current_status == "accepted":
                raise ValueError(f"승인된 제안은 기각할 수 없습니다: {proposal_id}")
            p["status"] = "rejected"
            p["rejected_at"] = datetime.now(timezone.utc).isoformat()
            _write(PROPOSALS_FILE, data)
            return p
    return None

# ------------------------------------------------------------------ 위키 노드 (제안 승고 연동)

def upsert_wiki_node(
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
) -> dict[str, Any]:
    """위키 노드를 생성/갱신한다.

    node_id가 있으면 갱신(이력 보존), 없으면 신규 생성.
    source: 생성 주체 구분 ("ai_proposal", "user_edit", "direct" 등)
    source_ref: 출처 참조 ID (제안 ID, 편집 세션 ID 등)
    before_content/after_content: 변경 전후 내용 (source="ai_proposal"인 경우)
    """
    _ensure()
    related = related or []
    tags = tags or []
    nodes = _read(WIKI_NODES_FILE)

    now = datetime.now(timezone.utc).isoformat()

    if node_id:
        for n in nodes:
            if n.get("id") == node_id:
                # 변경 이력 보존: 이전 내용을 history에 추가
                history = n.get("history", [])
                history.append({
                    "content": n.get("content"),
                    "title": n.get("title"),
                    "summary": n.get("summary"),
                    "tags": n.get("tags"),
                    "related": n.get("related"),
                    "updated_at": n.get("updated_at"),
                })
                # 최신 내용으로 갱신
                n["title"] = title
                n["summary"] = summary
                n["content"] = content
                n["related"] = related
                n["tags"] = tags
                n["updated_at"] = now
                if source:
                    n["source"] = source
                if source_ref:
                    n["source_ref"] = source_ref
                if before_content is not None:
                    n["before_content"] = before_content
                if after_content is not None:
                    n["after_content"] = after_content
                if history:
                    n["history"] = history
                _write(WIKI_NODES_FILE, nodes)
                return n
        # node_id가 존재하지 않으면 신규 생성으로 처리

    record = {
        "id": str(uuid.uuid4()) if not node_id else node_id,
        "title": title,
        "summary": summary,
        "content": content,
        "related": related,
        "tags": tags,
        "source": source,
        "source_ref": source_ref,
        "before_content": before_content,
        "after_content": after_content,
        "created_at": now,
        "updated_at": now,
    }
    nodes.append(record)
    _write(WIKI_NODES_FILE, nodes)
    return record

def accept_proposal_with_wiki(
    proposal_id: str,
    wiki_title: str,
    wiki_summary: str,
    wiki_content: dict[str, Any],
    wiki_related: list[str] | None = None,
    wiki_tags: list[str] | None = None,
    wiki_source: str = "user_approved",
    wiki_source_ref: str | None = None,
    wiki_before_content: dict[str, Any] | None = None,
    wiki_after_content: dict[str, Any] | None = None,
    target_node_id: str | None = None,
    _test_fail_proposal: bool = False,  # 테스트용: proposal 저장 실패 유발
) -> dict[str, Any]:
    """
    위키 작업 + 제안 승고를 원자적으로 처리.

    1. 위키 생성/수정 수행
    2. proposal 상태 변경 (accepted)
    3. proposal에 wiki_id 저장
    4. proposal 상태 변경 실패 시 wiki 롤백

    반환: {"proposal": ..., "wiki": ..., "wiki_created": bool, "wiki_id": str}
    """
    _ensure()

    # 이미 승인된 제안이면 위키 작업 전에 차단
    data = _read(PROPOSALS_FILE)
    for p in data:
        if p.get("id") == proposal_id:
            if p.get("status") == "accepted":
                raise ValueError(f"이미 승인된 제안입니다: {proposal_id}")
            break

    wiki = None
    wiki_id = None
    wiki_created = False
    before_snapshot = None  # change: 승인 전 위키 상태 스냅샷 (롤백용)
    
    if target_node_id:
        # change: 승인 전 위키 상태를 저장해둠 (롤백용)
        before_nodes = _read(WIKI_NODES_FILE)
        for bn in before_nodes:
            if bn.get("id") == target_node_id:
                before_snapshot = copy.deepcopy(bn)
                break
    
    try:
        # 1. 위키 작업 수행
        wiki = upsert_wiki_node(
            node_id=target_node_id,
            title=wiki_title,
            summary=wiki_summary,
            content=wiki_content,
            related=wiki_related,
            tags=wiki_tags,
            source=wiki_source,
            source_ref=wiki_source_ref,
            before_content=wiki_before_content,
            after_content=wiki_after_content,
        )
        wiki_id = wiki.get("id")
        wiki_created = target_node_id is None

        # 2. proposal 상태 변경 + wiki_id 저장
        if _test_fail_proposal:
            raise ValueError("테스트용 proposal 저장 실패")

        data = _read(PROPOSALS_FILE)
        found = False
        for p in data:
            if p.get("id") == proposal_id:
                current_status = p.get("status", "pending")
                if current_status == "accepted":
                    raise ValueError(f"이미 승인된 제안입니다: {proposal_id}")
                if current_status == "rejected":
                    raise ValueError(f"기각된 제안은 다시 승인할 수 없습니다: {proposal_id}")
                p["status"] = "accepted"
                p["accepted_at"] = datetime.now(timezone.utc).isoformat()
                p["wiki_id"] = wiki_id
                found = True
                break

        if not found:
            raise ValueError(f"제안을 찾을 수 없습니다: {proposal_id}")

        _write(PROPOSALS_FILE, data)

        return {
            "proposal": p,
            "wiki": wiki,
            "wiki_created": wiki_created,
            "wiki_id": wiki_id,
        }

    except Exception as e:
        # proposal 상태 변경 실패 시 wiki 롤백
        if wiki_id:
            nodes = _read(WIKI_NODES_FILE)
            for i, n in enumerate(nodes):
                if n.get("id") == wiki_id:
                    if before_snapshot is not None:
                        # change: 승인 전 스냅샷으로 전체 복원 (source_ref, before_content, after_content 포함)
                        nodes[i] = before_snapshot
                        _write(WIKI_NODES_FILE, nodes)
                    elif n.get("history"):
                        # change인데 before_snapshot이 없는 경우 (예외 상황): history 기반 복원
                        prev = n["history"][-1]
                        n["title"] = prev.get("title", n.get("title"))
                        n["summary"] = prev.get("summary", n.get("summary"))
                        n["content"] = prev.get("content", n.get("content"))
                        n["related"] = prev.get("related", n.get("related"))
                        n["tags"] = prev.get("tags", n.get("tags"))
                        n["updated_at"] = prev.get("updated_at", n.get("updated_at"))
                        n["history"] = n["history"][:-1]
                        _write(WIKI_NODES_FILE, nodes)
                    else:
                        # add: 신규 생성된 node 삭제
                        nodes.pop(i)
                        _write(WIKI_NODES_FILE, nodes)
                    break
        raise e

def list_wiki_nodes(limit: int = 100) -> list[dict[str, Any]]:
    data = _read(WIKI_NODES_FILE)
    data = sorted(data, key=lambda x: x.get("updated_at", ""), reverse=True)
    return data[:limit]

def get_wiki_node(node_id: str) -> dict[str, Any] | None:
    for n in _read(WIKI_NODES_FILE):
        if n.get("id") == node_id:
            return n
    return None

def search_wiki_nodes(query: str, limit: int = 20) -> list[dict[str, Any]]:
    """간단한 텍스트 검색. 실제로는 임베딩/벡터 검색을 붙여야 한다(MVP 이후)."""
    q = query.lower()
    nodes = _read(WIKI_NODES_FILE)
    results: list[tuple[dict[str, Any], int]] = []
    for n in nodes:
        haystack = " ".join(
            str(v)
            for v in [
                n.get("title"),
                n.get("summary"),
                n.get("content"),
                n.get("tags"),
                n.get("related"),
            ]
        ).lower()
        if q in haystack:
            results.append((n, haystack.count(q)))
    results.sort(key=lambda x: x[1], reverse=True)
    return [r[0] for r in results[:limit]]
