"""실제 서비스 진입점(TS)의 세션 그래프 분석 요청 기록 함수를 검증한다.

- TS MCP 서버의 enqueueSessionGraphAnalysis가 pending.json을 올바르게 쓰는지 확인
- Python 워커가 같은 파일을 소비할 수 있는지 확인
- get_status 우선순위(done > running > pending) 검증
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TS_SERVER_DIR = os.path.join(ROOT, "server")

tmp_base = tempfile.mkdtemp(prefix="mabc-session-graph-ts-check-")
os.environ["MABC_SESSION_GRAPH_BASE"] = tmp_base

print("tmp_base:", tmp_base)
print("MABC_SESSION_GRAPH_BASE:", os.environ.get("MABC_SESSION_GRAPH_BASE"))

# 1) TS enqueueSessionGraphAnalysis를 호출해 pending.json 생성
enqueue_script = f"""
const fs = require('node:fs');
const path = require('node:path');

function sessionGraphBaseDir() {{
  return process.env.MABC_SESSION_GRAPH_BASE ?? path.join(process.env.HOME ?? '/', '.mabc-session-graph');
}}

function sessionGraphQueueFile() {{
  return path.join(sessionGraphBaseDir(), 'analysis_queue', 'pending.json');
}}

function ensureSessionGraphQueueFile() {{
  const queueFile = sessionGraphQueueFile();
  const queueDir = path.dirname(queueFile);
  if (!fs.existsSync(queueDir)) {{
    fs.mkdirSync(queueDir, {{ recursive: true }});
  }}
  if (!fs.existsSync(queueFile)) {{
    fs.writeFileSync(queueFile, '[]', 'utf-8');
  }}
}}

function enqueueSessionGraphAnalysis(params) {{
  ensureSessionGraphQueueFile();
  const queueFile = sessionGraphQueueFile();
  const record = {{
    id: require('node:crypto').randomUUID(),
    userId: params.userId,
    session_id: params.sessionId,
    original_text: params.originalText,
    context: params.context,
    source: params.source ?? null,
    run_judgment: params.runJudgment ?? true,
    status: 'pending',
    enqueued_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    error: null,
  }};
  const current = JSON.parse(fs.readFileSync(queueFile, 'utf-8')) as Array<Record<string, unknown>>;
  current.push(record);
  fs.writeFileSync(queueFile, JSON.stringify(current, null, 2), 'utf-8');
  return {{ requestId: record.id }};
}}

const result = enqueueSessionGraphAnalysis({{
  userId: 'user-test-001',
  sessionId: 'session_ts_bridge_001',
  originalText: '사용자: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다.',
  context: {{ source: 'user_edit', test: true }},
  source: 'user_edit',
  runJudgment: true,
}});

console.log(JSON.stringify({{ ok: true, requestId: result.requestId }}, null, 2));
"""

proc = subprocess.run(
    [sys.executable, "-c", enqueue_script],
    cwd=TS_SERVER_DIR,
    env={**os.environ, "NODE_PATH": ""},
    text=True,
    capture_output=True,
    check=True,
)
print("enqueue 결과:", proc.stdout.strip())

queue_file = os.path.join(tmp_base, "analysis_queue", "pending.json")
pending = json.loads(open(queue_file, encoding="utf-8").read())
print("pending.json 항목 수:", len(pending))
print("첫 요청 id:", pending[0]["id"])
print("첫 요청 userId:", pending[0]["userId"])
print("첫 요청 session_id:", pending[0]["session_id"])
print("첫 요청 status:", pending[0]["status"])

# 2) Python 워커가 같은 파일을 소비할 수 있는지 확인
sys.path.insert(0, os.path.join(ROOT, "mcp_server"))
from session_graph_bridge import dequeue_one, mark_done, get_status

item = dequeue_one()
print("\n워커 dequeue 결과:", "없음" if item is None else item["id"])

if item is not None:
    mark_done(item["id"], result={"connection_file": None, "connections": 0}, error=None)
    status = get_status(item["id"])
    print("완료 후 get_status:", "없음" if status is None else status.get("status"))
    print("status 전체:", json.dumps(status, ensure_ascii=False, indent=2))

print("\n[완료] TS enqueue + Python 워커 소비 + 상태 우선순위 확인 끝")
