import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { ProposalsResponse } from '@shared/api';

function statusBadge(status: string) {
  if (status === '제안됨') return <span className="badge badge-blue">제안됨</span>;
  if (status === '승인됨') return <span className="badge badge-green">승인됨</span>;
  if (status === '기각됨') return <span className="badge badge-warm">기각됨</span>;
  return <span className="badge">{status}</span>;
}

function typeBadge(type: string) {
  if (type === '추가') return <span className="badge badge-blue">추가</span>;
  if (type === '변경·분리') return <span className="badge badge-warm">변경·분리</span>;
  if (type === '연결') return <span className="badge badge-green">연결</span>;
  return <span className="badge">{type}</span>;
}

function proposalStatusLabel(status: string) {
  if (status === '제안됨') return '제안 대기';
  if (status === '승인됨') return '승인됨';
  if (status === '기각됨') return '기각됨';
  return status;
}

export default function ProposalsList() {
  const [proposals, setProposals] = useState<ProposalsResponse['proposals']>([]);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProposals()
      .then((res) => setProposals(res.proposals))
      .catch(() => setProposals([]))
      .finally(() => setLoading(false));
  }, []);

  const isDeletable = (p: typeof proposals[0]) => p.status !== '제안됨';

  const startDelete = (id: string) => {
    if (deletingIds.has(id)) return;
    setPendingDeleteId(id);
    setDeleteErrorId(null);
  };

  const confirmDelete = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    setDeleteErrorId(null);
    try {
      await api.deleteProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setDeleteErrorId(id);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setPendingDeleteId(null);
    }
  };

  const cancelDelete = () => {
    setPendingDeleteId(null);
    setDeleteErrorId(null);
  };

  if (loading) return <p className="hint">불러오는 중...</p>;

  return (
    <div className="container">
      <h2>제안 목록</h2>
      <p className="hint">
        대화에서 발견한 위키 초안과 갱신 제안입니다. 수락한 것만 위키에 반영됩니다.
      </p>

      {proposals.length === 0 ? (
        <div className="card">
          <p>아직 제안이 없어요.</p>
          <p className="hint">
            대화를 정리하면 여기에 제안이 쌓입니다.
          </p>
        </div>
      ) : (
        proposals.map((p) => (
          <div key={p.id} className="card proposal-card">
            <div className="proposal-head">
              <div>
                <p className="proposal-action">
                  <Link to={`/proposal/${p.id}`}>{p.action}</Link>
                </p>
                <p className="proposal-reason">{p.reason}</p>
              </div>
              <div className="proposal-tags">
                {typeBadge(p.type)}
                {statusBadge(p.status)}
              </div>
              <p className="proposal-status-label">{proposalStatusLabel(p.status)}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
