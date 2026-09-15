"""MCP submit_conversation과 세션 그래프 엔진 간 연결.

- MCP가 원문을 저장한 뒤, 그래프 분석 요청을 대기열에 넣는다.
- 별도 워커가 대기열을 소비해 세션 그래프 엔진(session_graph_api.ingest_session)을 실행한다.
- 실제 추출/개념화/GraphML/연결 판단은 세션 그래프 엔진이 처리한다.
- Solar 호출은 테스트 환경에서만 가짜 응답으로 대체할 수 있다.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# MCP store와 분리해서 분석 대기열을 관리한다.
MG_BASE = Path(os.environ.get("MABC_SESSION_GRAPH_BASE", Path.home() / ".mabc-session-graph"))
QUEUE_DIR = MG_BASE / "analysis_queue"
QUEUE_DIR.mkdir(parents=True, exist_ok=True)
QUEUE_FILE = QUEUE_DIR / "pending.json"
RUNNING_FILE = QUEUE_DIR / "running.json"
DONE_FILE = QUEUE_DIR / "done.json"


def _ensure(path: Path, default: Any) -> None:
    if not path.exists():
        path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")


def _read(path: Path) -> list[dict[str, Any]]:
    _ensure(path, [])
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write(path: Path, data: list[dict[str, Any]]) -> None:
    _ensure(path, [])
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def enqueue_analysis(
    session_id: str,
    original_text: str,
    context: dict[str, Any],
    *,
    run_judgment: bool = True,
) -> dict[str, Any]:
    """submit_conversation 이후에 분석 요청을 대기열에 넣는다."""
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "original_text": original_text,
        "context": context,
        "run_judgment": run_judgment,
        "status": "pending",
        "enqueued_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "finished_at": None,
        "result": None,
        "error": None,
    }
    data = _read(QUEUE_FILE)
    data.append(record)
    _write(QUEUE_FILE, data)
    return record


def dequeue_one() -> dict[str, Any] | None:
    """가장 오래된 pending 요청을 running으로 옮기고 반환한다."""
    data = _read(QUEUE_FILE)
    pending = [r for r in data if r.get("status") == "pending"]
    if not pending:
        return None
    item = pending[0]
    data = [r if r.get("id") != item["id"] else {**r, "status": "running"} for r in data]
    _write(QUEUE_FILE, data)
    _ensure(RUNNING_FILE, [])
    running = _read(RUNNING_FILE)
    running.append(item)
    _write(RUNNING_FILE, running)
    return item


def mark_done(item_id: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
    data = _read(RUNNING_FILE)
    item = next((r for r in data if r.get("id") == item_id), None)
    if not item:
        return
    data = [r for r in data if r.get("id") != item_id]
    _write(RUNNING_FILE, data)
    done_item = {**item, "status": "done" if error is None else "failed", "finished_at": datetime.now(timezone.utc).isoformat(), "result": result, "error": error}
    _ensure(DONE_FILE, [])
    done_list = _read(DONE_FILE)
    done_list.append(done_item)
    _write(DONE_FILE, done_list)


def list_pending(limit: int = 50) -> list[dict[str, Any]]:
    data = _read(QUEUE_FILE)
    pending = [r for r in data if r.get("status") == "pending"]
    return pending[-limit:]


def get_status(item_id: str) -> dict[str, Any] | None:
    """분석 요청 상태를 상태 우선순위에 따라 조회한다.

    완료(done/failed) > 실행 중(running) > 대기(pending) 순서다.
    mark_done 이후 running.json에 stale 레코드가 남아 있어도
    완료된 상태가 먼저 반환된다.
    """
    candidates: list[tuple[int, dict[str, Any]]] = []

    # 1) 완료/실패 우선
    done_data = _read(DONE_FILE)
    for r in done_data:
        if r.get("id") == item_id:
            candidates.append((0, r))

    # 2) 실행 중
    running_data = _read(RUNNING_FILE)
    for r in running_data:
        if r.get("id") == item_id:
            candidates.append((1, r))

    # 3) 대기
    pending_data = _read(QUEUE_FILE)
    for r in pending_data:
        if r.get("id") == item_id:
            candidates.append((2, r))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]
