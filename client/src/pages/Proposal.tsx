import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import type { Proposal } from '@shared/api';

const DECISION_KEY = 'mabc_decisions';

interface DecisionRecord {
  proposalId: string;
  action: '수락' | '기각';
  at: string;
}

function loadDecision(proposalId: string): DecisionRecord | undefined {
  try {
    const raw = localStorage.getItem(DECISION_KEY);
    if (!raw) return undefined;
    const decisions: DecisionRecord[] = JSON.parse(raw);
    return decisions.find((d) => d.proposalId === proposalId);
  } catch {
    return undefined;
  }
}

function saveDecision(rec: DecisionRecord): void {
  try {
    const raw = localStorage.getItem(DECISION_KEY);
    const decisions: DecisionRecord[] = raw ? JSON.parse(raw) : [];
    const filtered = decisions.filter((d) => d.proposalId !== rec.proposalId);
    localStorage.setItem(DECISION_KEY, JSON.stringify([...filtered, rec]));
  } catch {}
}
function ConnectionProposalPreview({ proposal }: { proposal: Proposal }) {
  const payload =
    proposal.changePayload &&
    typeof proposal.changePayload === 'object'
      ? (proposal.changePayload as Record<string, unknown>)
      : {};

  const relationType =
    typeof payload.relationType === 'string' && payload.relationType.trim()
      ? payload.relationType
      : '연관';

  const sourceConceptType =
    typeof payload.sourceConceptType === 'string' && payload.sourceConceptType.trim()
      ? payload.sourceConceptType.trim()
      : undefined;

  const targetConceptType =
    typeof payload.targetConceptType === 'string' && payload.targetConceptType.trim()
      ? payload.targetConceptType.trim()
      : undefined;

  const schemaReason =
    typeof payload.schemaReason === 'string' && payload.schemaReason.trim()
      ? payload.schemaReason.trim()
      : undefined;

  const sourceTitle =
    proposal.sourceNode?.title ??
    proposal.sourceNodeId ??
    '출발 위키를 찾을 수 없음';

  const targetTitle =
    proposal.targetNode?.title ??
    proposal.targetNodeId ??
    '도착 위키를 찾을 수 없음';

  return (
    <div className="connection-preview">
      <div className="connection-node-card">
        <span className="connection-node-label">출발 위키</span>

        {proposal.sourceNode ? (
          <Link
            to={`/node/${proposal.sourceNode.id}`}
            className="connection-node-title"
          >
            {sourceTitle}
          </Link>
        ) : (
          <strong className="connection-node-title">{sourceTitle}</strong>
        )}

        {proposal.sourceNode?.summary && (
          <p className="connection-node-summary">
            {proposal.sourceNode.summary}
          </p>
        )}

        {sourceConceptType && (
          <p className="connection-concept-type">{sourceConceptType}</p>
        )}
      </div>

      <div className="connection-relation">
        <span className="badge badge-green">{relationType}</span>
        <span className="connection-arrow" aria-hidden="true">
          →
        </span>
        <p className="connection-action">{proposal.action}</p>

        {schemaReason && (
          <p className="connection-schema-reason">
            <span className="connection-schema-label">스키마 판단</span>
            {' '}{schemaReason}
          </p>
        )}
      </div>

      <div className="connection-node-card">
        <span className="connection-node-label">도착 위키</span>

        {proposal.targetNode ? (
          <Link
            to={`/node/${proposal.targetNode.id}`}
            className="connection-node-title"
          >
            {targetTitle}
          </Link>
        ) : (
          <strong className="connection-node-title">{targetTitle}</strong>
        )}

        {proposal.targetNode?.summary && (
          <p className="connection-node-summary">
            {proposal.targetNode.summary}
          </p>
        )}

        {targetConceptType && (
          <p className="connection-concept-type">{targetConceptType}</p>
        )}
      </div>
    </div>
  );
}

function renderCompare(proposal: Proposal) {
  if (proposal.type === '추가') {
    return (
      <div className="compare">
        <div className="compare-col">
          <h4>변경 전</h4>
          <p className="compare-summary">새 노드</p>
        </div>
        <div className="compare-col">
          <h4>변경 후</h4>
          <NewNodePreview payload={proposal.draftPayload} />
        </div>
      </div>
    );
  }
  if (proposal.type === '연결') {
    return <ConnectionProposalPreview proposal={proposal} />;
  }
  return (
    <div className="compare">
      <div className="compare-col">
        <h4>변경 전</h4>
        <p className="compare-summary">{proposal.before?.summary ?? ''}</p>
        <div className="compare-content">{proposal.before?.content ?? ''}</div>
      </div>
      <div className="compare-col">
        <h4>변경 후</h4>
        <p className="compare-summary">{proposal.after?.summary ?? ''}</p>
        <div className="compare-content">{proposal.after?.content ?? ''}</div>
      </div>
    </div>
  );
}

function NewNodePreview({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== 'object') {
    return <p className="hint">draftPayload가 없습니다.</p>;
  }
  const p = payload as Record<string, unknown>;
  const title = String(p.title ?? '');
  const summary = String(p.summary ?? '');
  const content = String(p.content ?? '');
  const topics = Array.isArray(p.topics) ? p.topics.filter((x): x is string => typeof x === 'string') : [];
  const tags = Array.isArray(p.tags) ? p.tags.filter((x): x is string => typeof x === 'string') : [];
  const categories = Array.isArray(p.categories) ? p.categories.filter((x): x is string => typeof x === 'string') : [];

  return (
    <div>
      {title && <p className="compare-summary"><strong>제목:</strong> {title}</p>}
      {summary && <p className="compare-summary"><strong>요약:</strong> {summary}</p>}
      {content && <div className="compare-content">{content}</div>}
      {(topics.length > 0 || tags.length > 0 || categories.length > 0) && (
        <div className="compare-meta">
          {topics.length > 0 && <p><strong>토픽:</strong> {topics.join(', ')}</p>}
          {tags.length > 0 && <p><strong>태그:</strong> {tags.join(', ')}</p>}
          {categories.length > 0 && <p><strong>분류:</strong> {categories.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setProposal(null);
      setLoading(false);
      return;
    }
    api
      .getProposal(id)
      .then((res) => {
        setProposal(res.proposal);
        const existing = loadDecision(id);
        if (existing && res.proposal.status === '제안됨') {
          setProposal((prev) =>
            prev ? { ...prev, status: existing.action === '수락' ? '승인됨' : '기각됨', decisionAction: existing.action } : null
          );
        }
      })
      .catch(() => setProposal(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDecide(action: '수락' | '기각') {
    if (!id) return;
    try {
      const res = await api.decideProposal(id, { action });
      saveDecision({ proposalId: id, action, at: new Date().toISOString() });
      setSaved(true);
      setProposal((previous) => {
  if (!previous) {
    return res.proposal;
  }

  return {
    ...previous,
    ...res.proposal,
    sourceNode: res.proposal.sourceNode ?? previous.sourceNode,
    targetNode: res.proposal.targetNode ?? previous.targetNode,
  };
});
    } catch (err) {
      setError(err instanceof Error ? err.message : '결정 반영에 실패했어요.');
    }
  }

  if (loading) return <p className="hint">로딩 중...</p>;

  if (!proposal) {
    return (
      <div>
        <Link to="/proposals" className="btn btn-ghost">← 제안 목록</Link>        <h2>제안 목록</h2>
        <p className="hint">아직 표시할 제안이 없습니다.</p>
      </div>
    );
  }

  const decided = loadDecision(proposal.id);

  return (
    <div className="container">
        <Link to="/proposals" className="btn btn-ghost">← 제안 목록</Link>      <div className="flex items-center gap-xs mb-md">
        <h2>제안 — {proposal.type}</h2>
        <span className="badge badge-blue">{proposal.status}</span>
      </div>

      <div className="decide-section">
        <h3>
  {proposal.type === '연결'
    ? '어떤 위키를 연결하는지 확인'
    : '무엇이 바뀌는지 미리 보기'}
</h3>
        {renderCompare(proposal)}
      </div>

      <div className="card rationale-card">
        <h3>왜 이 제안인지</h3>
        <p className="rationale-reason">{proposal.reason}</p>
        <hr className="rationale-divider" />
        <div className="rationale-evidence">
          <strong>근거:</strong>
          {proposal.evidence && proposal.evidence.length > 0 ? (
            <ul className="evidence-list">
              {proposal.evidence.map((e) => (
                <li key={e.id} className="evidence-item">
                  <span className="evidence-quote">{e.quote || '(인용 없음)'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="evidence-empty">근거가 없습니다.</p>
          )}
        </div>
      </div>

      {decided && (
        <p className="decided-msg">
          이미 {decided.action}하셨습니다. (결정 시각: {new Date(decided.at).toLocaleString()})
        </p>
      )}

      {error && (
        <p className="error-msg">{error}</p>
      )}

      <div className="decide-actions">
        {proposal.status === '제안됨' && (
          <>
            <button className="btn btn-primary" onClick={() => handleDecide('수락')} disabled={saved}>
              수락
            </button>
            <button className="btn btn-danger" onClick={() => handleDecide('기각')} disabled={saved}>
              기각
            </button>
          </>
        )}
        {proposal.status === '반영됨' && <p className="reflected-msg">위키에 반영됨</p>}
        {proposal.status === '기각됨' && <p className="rejected-msg">제안이 기각됨</p>}
        {saved && proposal.status !== '반영됨' && proposal.status !== '기각됨' && <p className="saved-msg">반영 완료 (새로고침해도 유지됨)</p>}
      </div>
    </div>
  );
}
