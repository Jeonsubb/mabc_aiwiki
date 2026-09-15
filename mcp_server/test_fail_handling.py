"""analysis_status=fail이 failed로 기록되는지 확인한다.

- 대기열에 요청을 하나 넣는다.
- 워커가 dequeue한 뒤 ingest_session 대신 가짜 응답(analysis_status=fail)을 반환하게 한다.
- mark_done이 failed로 기록하는지 확인한다.
- get_status가 failed를 우선 반환하는지 확인한다.
- running.json에 stale이 남아 있어도 done/failed가 먼저 조회되는지 확인한다.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MCP_PY = ROOT / "mcp_server"

tmp_base = tempfile.mkdtemp(prefix="mabc-session-graph-fail-test-")
os.environ["MABC_SESSION_GRAPH_BASE"] = tmp_base

sys.path.insert(0, str(MCP_PY))
sys.path.insert(0, str(ROOT / "session-graph"))

from mcp_server.session_graph_bridge import (
    enqueue_analysis,
    dequeue_one,
    mark_done,
    get_status,
    QUEUE_FILE,
    RUNNING_FILE,
    DONE_FILE,
)

# 1) 요청 생성
rec = enqueue_analysis(
    session_id="fail-test-session",
    original_text="사용자: 테스트 실패 확인용 대화입니다.",
    context={"source": "user_edit", "test": True},
    run_judgment=True,
)
req_id = rec["id"]
print("생성된 요청 id:", req_id)
print("초기 pending.json:", json.dumps(json.loads(QUEUE_FILE.read_text(encoding="utf-8")), ensure_ascii=False, indent=2))

# 2) 워커가 dequeue
item = dequeue_one()
print("\ndequeue 결과:", "없음" if item is None else item["id"])
assert item is not None
assert item["id"] == req_id

# 3) 가짜 ingest 결과: analysis_status=fail
fake_result = {
    "session_id": item["session_id"],
    "original_text_source": "fake",
    "extraction": {"reused": False, "path": None, "mode": "fake_failed"},
    "conceptualization": {"graphml_path": None, "status": "fail", "mode": "fake"},
    "analysis_status": "fail",
    "connections_file": None,
    "connections": [],
    "candidate_count": 0,
    "session_index_summary": {},
}

# 4) failed로 기록
mark_done(req_id, result=fake_result, error="분석 실패(추출/개념/GraphML)")
print("\nmark_done 이후 DONE_FILE:")
print(json.dumps(json.loads(DONE_FILE.read_text(encoding="utf-8")), ensure_ascii=False, indent=2))

# 5) 상태 조회
status = get_status(req_id)
print("\nget_status 결과:")
print(json.dumps(status, ensure_ascii=False, indent=2))
assert status is not None
assert status.get("status") == "failed", f"failed 예상, 실제: {status.get('status')}"

# 6) running.json에 stale이 남아 있어도 failed가 우선인지 확인
running = json.loads(RUNNING_FILE.read_text(encoding="utf-8"))
print("\nrunning.json 항목 수:", len(running))

# running에 같은 id를 인위적으로 남겨도 우선순위가 유지되는지 확인한다.
RUNNING_FILE.write_text(json.dumps([{"id": req_id, "status": "running", "finished_at": None}], ensure_ascii=False, indent=2), encoding="utf-8")
status2 = get_status(req_id)
print("\nrunning stale 남긴 뒤 get_status:")
print(json.dumps(status2, ensure_ascii=False, indent=2))
assert status2 is not None
assert status2.get("status") == "failed", f"stale 있어도 failed 우선 예상, 실제: {status2.get('status')}"

print("\n[완료] analysis_status=fail -> failed 기록 + 우선순위 확인 끝")
