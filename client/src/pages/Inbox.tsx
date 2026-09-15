import { useEffect, useState } from 'react';

import { api } from '../services/api';
import type { RecordsResponse } from '@shared/api';

function statusLabel(status: string) {
  if (status === '보관됨') return <span className="badge badge-blue">보관됨</span>;
  if (status === '후보생성중') return <span className="badge badge-warm">후보 생성 중</span>;
  if (status === '제안됨') return <span className="badge badge-green">제안됨</span>;
  if (status === '처리됨') return <span className="badge badge-success">처리됨</span>;
  if (status === '제안 없음') return <span className="badge badge-warm">제안 없음</span>;
  if (status === '실패') return <span className="badge badge-error">실패</span>;
  if (status === '처리중') return <span className="badge badge-warm">처리 중</span>;
  return <span className="badge">{status}</span>;
}

export default function Inbox() {
  const [records, setRecords] = useState<RecordsResponse['records']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRecords()
      .then((res) => setRecords(res.records))
      .catch((err) => setError(err instanceof Error ? err.message : '기록 불러오기 실패'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="hint">불러오는 중...</p>;

  return (
    <div className="container">
      
      <h2>보관된 대화 유입 기록</h2>
      <p className="hint">
        AI 에이전트가 보낸 대화 원문이 여기에 보관됩니다.
      </p>

      {error ? (
        <div className="card">
          <p className="record-error">오류: {error}</p>
        </div>
      ) : records.length === 0 ? (
        <div className="card">
          <p>아직 보관된 대화가 없어요.</p>
          <p className="hint">
            AI 에이전트에서 위키 저장을 요청하면 여기에 쌓입니다.
          </p>
        </div>
      ) : (
        records.map((r) => (
          <div key={r.id} className="card">
            <div className="inbox-head">
              <div className="inbox-main">
                <p className="record-id">유입 ID: {r.id}</p>
                <p className="record-session">세션: {r.session_id}</p>
                <p className="record-text">{r.conversation_text}</p>
              </div>
              <div className="inbox-meta">
                <p className="record-stored">저장: {new Date(r.stored_at).toLocaleString()}</p>
                <p className="record-status">{statusLabel(r.status)}</p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
