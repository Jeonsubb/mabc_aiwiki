const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sessionGraphBaseDir() {
  return process.env.MABC_SESSION_GRAPH_BASE ?? path.join(process.env.HOME ?? '/', '.mabc-session-graph');
}

function sessionGraphQueueFile() {
  return path.join(sessionGraphBaseDir(), 'analysis_queue', 'pending.json');
}

function ensureSessionGraphQueueFile() {
  const queueFile = sessionGraphQueueFile();
  const queueDir = path.dirname(queueFile);
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }
  if (!fs.existsSync(queueFile)) {
    fs.writeFileSync(queueFile, '[]', 'utf-8');
  }
}

function enqueueSessionGraphAnalysis(params) {
  ensureSessionGraphQueueFile();
  const queueFile = sessionGraphQueueFile();
  const record = {
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
  };
  const current = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  current.push(record);
  fs.writeFileSync(queueFile, JSON.stringify(current, null, 2), 'utf-8');
  return { requestId: record.id };
}

const result = enqueueSessionGraphAnalysis({
  userId: 'user-test-001',
  sessionId: 'session_ts_bridge_001',
  originalText: '사용자: 배터리 성능이 예전보다 떨어진 것 같아요. 상담사: 사용 패턴을 확인해 보겠습니다.',
  context: { source: 'user_edit', test: true },
  source: 'user_edit',
  runJudgment: true,
});

console.log(JSON.stringify({ ok: true, requestId: result.requestId }, null, 2));
