import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { RecordsResponse } from '@shared/api';

function statusLabel(status: string) {
  if (status === '보관됨') return <span className="badge badge-blue">보관됨</span>;
  if (status === '후보생성중') return <span className="badge badge-warm">후보 생성 중</span>;
  if (status === '제안됨') return <span className="badge badge-green">제안됨</span>;
  return <span className="badge">{status}</span>;
}

export default function Inbox() {
  const [records, setRecords] = useState<RecordsResponse['records']>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getRecords()
      .then((res) => setRecords(res.records))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="hint">불러오는 중...</p>;

  return (
    <div>
      <nav className="inbox-nav">
        <Link to="/" className="btn btn-ghost">← 허브</Link>
      </nav>

      <h2>보관된 대화 유입 기록</h2>
      <p className="hint">
        저장 경로: /records · MCP로 들어온 대화 구간이 쌓입니다.
      </p>

      {records.length === 0 ? (
        <div className="card">
          <p>아직 MCP로 들어온 대화 기록이 없어요.</p>
          <p className="hint">
            AI 에이전트에서 위키 저장 요청하면 여기 쌓입니다.
          </p>
        </div>
      ) : (
        records.map((r) => (
          <div key={r.id} className="card">
            <div className="inbox-head">
              <div className="inbox-main">
                <p className="record-id">유입 ID: {r.id}</p>
                <p className="record-title">대화 {r.conversationId}</p>
              </div>
              {statusLabel(r.status)}
            </div>
            <p className="record-meta">
              출처: {r.source} · 수신: {new Date(r.receivedAt).toLocaleString()}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
