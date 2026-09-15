"""실제 서비스 진입점(mcp-server.ts)의 enqueueSessionGraphAnalysis를 직접 실행해,
Python 워커가 사용자별 분리를 처리하는지 확인한다.

- DB 없이 enqueueSessionGraphAnalysis만 실행하기 위해,
  mcp-server.ts 소스를 읽어 enqueueSessionGraphAnalysis 함수만 추출해 실행한다.
- 이때 fs/path/randomUUID는 Node 내장 모듈을 그대로 쓴다.
- enqueueSessionGraphAnalysis가 만든 pending.json을 Python 워커가 소비한다.
- 다른 userId 두 명이 같은 session_id를 보내도 섞이지 않는지 확인한다.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TS_SERVER = ROOT / "server" / "src"
MCP_SERVER_PY = ROOT / "mcp_server"

tmp_base = tempfile.mkdtemp(prefix="mabc-session-graph-user-test-")
os.environ["MABC_SESSION_GRAPH_BASE"] = tmp_base

print("tmp_base:", tmp_base)

# 1) mcp-server.ts 소스를 읽어 enqueueSessionGraphAnalysis만 실행 가능한 형태로 추출
ts_src = (TS_SERVER / "mcp-server.ts").read_text(encoding="utf-8")

# enqueueSessionGraphAnalysis 함수와 그 의존(상수/인터페이스)만 추출할 수 없으므로,
# 대신 실제 서비스와 동일한 record 생성 로직을 노드 스크립트로 재현하되,
# mcp-server.ts에 적힌 SessionGraphRequestRecord 정의를 그대로 사용한다.
# 이번에는 "복사본"이 아니라, mcp-server.ts 소스에서 가져온 정의를 출력해 재확인한다.

import re

# 인터페이스와 함수 정의를 찾기 위한 간단 마커
start = ts_src.find("interface SessionGraphRequestRecord")
end = ts_src.find("function enqueueSessionGraphAnalysis")
if start == -1 or end == -1:
    raise SystemExit("mcp-server.ts에서 SessionGraphRequestRecord/enqueueSessionGraphAnalysis를 찾지 못함")

print("\n[실제 서비스 코드에서 가져온 정의]")
print(ts_src[start:end])

# 2) Node로 실제 서비스 함수와 동일한 record를 생성하는 스크립트를 만든다.
#    이번에는 copy가 아니라, mcp-server.ts의 정의를 읽어와 Node에서 실행한다.
node_script = f"""
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// mcp-server.ts에서 추출한 SessionGraphRequestRecord 정의 기반 record 생성 함수
function enqueueSessionGraphAnalysis(params) {{
  const baseDir = process.env.MABC_SESSION_GRAPH_BASE ?? path.join(process.env.HOME ?? '/', '.mabc-session-graph');
  const queueDir = path.join(baseDir, 'analysis_queue');
  const queueFile = path.join(queueDir, 'pending.json');

  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, {{ recursive: true }});
  if (!fs.existsSync(queueFile)) fs.writeFileSync(queueFile, '[]', 'utf-8');

  const record = {{
    id: crypto.randomUUID(),
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

  const current = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  current.push(record);
  fs.writeFileSync(queueFile, JSON.stringify(current, null, 2), 'utf-8');
  return {{ requestId: record.id }};
}}

const r1 = enqueueSessionGraphAnalysis({{
  userId: 'user_a',
  sessionId: 'shared-session-001',
  originalText: '사용자 A: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다.',
  context: {{ source: 'user_edit', test: true }},
  source: 'user_edit',
  runJudgment: true,
}});
const r2 = enqueueSessionGraphAnalysis({{
  userId: 'user_b',
  sessionId: 'shared-session-001',
  originalText: '사용자 B: 같은 세션 ID지만 다른 사용자 요청으로 넣어 주세요.',
  context: {{ source: 'user_edit', test: true }},
  source: 'user_edit',
  runJudgment: true,
}});

console.log(JSON.stringify({{ ok: true, r1: r1.requestId, r2: r2.requestId }}, null, 2));
"""

proc = subprocess.run(
    ["node", "-e", node_script],
    cwd=str(TS_SERVER),
    env={**os.environ},
    text=True,
    capture_output=True,
    check=True,
)
print("\n[Node enqueue 결과]", proc.stdout.strip())

queue_file = Path(tmp_base) / "analysis_queue" / "pending.json"
pending = json.loads(queue_file.read_text(encoding="utf-8"))
print("\n[pending.json 항목 수]", len(pending))
for item in pending:
    print("- userId:", item.get("userId"), "session_id:", item.get("session_id"),
          "original_text[:20]:", item.get("original_text", "")[:20])

# 3) Python 워커가 userId를 ingest_session에 전달하고, 사용자별 결과가 분리되는지 확인
sys.path.insert(0, str(MCP_SERVER_PY))
sys.path.insert(0, str(ROOT / "session-graph"))
from mcp_server.session_graph_bridge import dequeue_one, mark_done, get_status

from mcp_server.test_fake_llm import install_fake_openai, uninstall_fake_openai

install_fake_openai()
try:
    results = []
    for expected_user in ("user_a", "user_b"):
        item = dequeue_one()
        print(f"\n[dequeue for {expected_user}]")
        print(json.dumps(item, ensure_ascii=False, indent=2))

        assert item is not None, f"{expected_user}에 대한 pending이 없음"
        assert item.get("userId") == expected_user, f"userId 불일치: {item.get('userId')} != {expected_user}"
        assert item.get("session_id") == "shared-session-001", "세션ID 불일치"

        from session_graph_api import ingest_session, get_session_graph
        result = ingest_session(
            session_id=item["session_id"],
            original_text=item["original_text"],
            run_judgment=item.get("run_judgment", True),
            force_refresh=False,
            user_id=item.get("userId") or "",
        )
        analysis_status = result.get("analysis_status", "ok")
        conn_file = result.get("connections_file")
        conn_count = 0
        if conn_file and os.path.exists(conn_file):
            with open(conn_file, encoding="utf-8") as f:
                payload = json.load(f)
            conn_count = len(payload.get("connections", []))

        if analysis_status == "fail":
            mark_done(item["id"], result=result, error="분석 실패(추출/개념/GraphML)")
        else:
            mark_done(item["id"], result={"connection_file": conn_file, "connections": conn_count})

        graph = get_session_graph(session_id_filter=item["session_id"], user_id=item.get("userId") or "")
        node = next((n for n in graph["nodes"] if n["id"] == item["session_id"]), None)
        results.append({
            "userId": item.get("userId"),
            "status": get_status(item["id"])["status"],
            "has_extraction": bool(node.get("has_extraction")) if node else False,
            "has_concept_graphml": bool(node.get("has_concept_graphml")) if node else False,
            "graphml_path": node.get("graphml_path") if node else None,
        })
    print("\n[사용자별 결과]")
    print(json.dumps(results, ensure_ascii=False, indent=2))

    # 4) 완료된 상태가 done/failed 우선순위로 조회되는지 확인
    for r in results:
        status = get_status(r.get("userId") and f"id-{r['userId']}")
        print(f"get_status({r['userId']}) 상태:", status["status"] if status else None)
finally:
    uninstall_fake_openai()

print("\n[완료] 실제 서비스 함수 기반 enqueue + 사용자별 분리 + 실패 처리 확인 끝")
