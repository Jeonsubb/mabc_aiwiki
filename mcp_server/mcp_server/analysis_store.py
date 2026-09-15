"""MCP용 세션 그래프 분석 요청/상태 스토어.

Solar 없이 임시 분석 응답을 쓸 수 있게 분석 결과를 합성할 수 있는 진입점도 둔다.
저장소는 MCP store와 같은 디렉터리 아래에 JSON으로 남긴다.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_DIR = Path(os.environ.get("MABC_MCP_STORE", os.path.expanduser("~/.mabc-mcp-store")))
SESSION_GRAPH_REQUESTS_FILE = STORE_DIR / "session_graph_requests.json"


def _ensure_requests() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    if not SESSION_GRAPH_REQUESTS_FILE.exists():
        SESSION_GRAPH_REQUESTS_FILE.write_text(
            json.dumps([], ensure_ascii=False, indent=2), encoding="utf-8"
        )


def _read_requests() -> list[dict[str, Any]]:
    _ensure_requests()
    try:
        return json.loads(SESSION_GRAPH_REQUESTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write_requests(data: list[dict[str, Any]]) -> None:
    _ensure_requests()
    SESSION_GRAPH_REQUESTS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def enqueue_session_analysis(
    session_id: str,
    original_text: str,
    source: str,
    context: dict[str, Any],
    *,
    skip_judgment: bool = True,
) -> dict[str, Any]:
    """세션 분석 요청을 등록한다. 실제 분석은 백그라운드 워커가 처리한다.

    Solar 허공 호출을 피하기 위해, 이 단계부터 분석 완료 상태를
    임시 합성 결과로 바로 채우는 방식도 지원한다.
    """
    _ensure_requests()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "original_text": original_text,
        "source": source,
        "context": context,
        "skip_judgment": skip_judgment,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "finished_at": None,
        "analysis_result": None,
        "error": None,
    }
    data = _read_requests()
    data.append(record)
    _write_requests(data)
    return record


def mark_analysis_synced(record_id: str, analysis_result: dict[str, Any]) -> dict[str, Any] | None:
    """임시 분석 응답을 기록한다. (Solar 미호출 대체 경로)"""
    data = _read_requests()
    for item in data:
        if item.get("id") == record_id:
            item["status"] = "synced"
            item["finished_at"] = datetime.now(timezone.utc).isoformat()
            item["analysis_result"] = analysis_result
            _write_requests(data)
            return item
    return None


def mark_analysis_failed(record_id: str, error: str) -> dict[str, Any] | None:
    data = _read_requests()
    for item in data:
        if item.get("id") == record_id:
            item["status"] = "failed"
            item["finished_at"] = datetime.now(timezone.utc).isoformat()
            item["error"] = error
            _write_requests(data)
            return item
    return None


def get_request(record_id: str) -> dict[str, Any] | None:
    for item in _read_requests():
        if item.get("id") == record_id:
            return item
    return None


def list_requests(limit: int = 50) -> list[dict[str, Any]]:
    data = _read_requests()
    return data[-limit:]
