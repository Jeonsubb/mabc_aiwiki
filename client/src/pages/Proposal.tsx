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

export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

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
      setProposal(res.proposal);
    } catch {
      alert('결정 반영에 실패했어요.');
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
        <h3>무엇이 바뀌는지 미리 보기</h3>
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
      </div>

      <div className="card rationale-card">
        <h3>왜 이 제안인지</h3>
        <p className="rationale-reason">{proposal.reason}</p>
        <hr className="rationale-divider" />
        <p className="rationale-evidence">
          <strong>근거:</strong> {proposal.evidence}
        </p>
      </div>

      {decided && (
        <p className="decided-msg">
          이미 {decided.action}하셨습니다. (결정 시각: {new Date(decided.at).toLocaleString()})
        </p>
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
        {saved && <p className="saved-msg">반영 완료 (새로고침해도 유지됨)</p>}
      </div>
    </div>
  );
}
