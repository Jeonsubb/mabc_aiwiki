import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { ChatListChat } from '@shared/api';

export default function ChatsListPage() {
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatListChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getChats();
      setChats(res.chats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '대화 목록을 불러오지 못함';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const createNew = async () => {
    try {
      const res = await api.createChat({});
      navigate(`/chats/${res.chat.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '대화방 생성 실패';
      setError(msg);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="container" style={{ paddingTop: 'var(--sp-xl)' }}>
      <header className="chat-list-header">
        <h2>내 대화방</h2>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? '새로고침 중…' : '새로고침'}
        </button>
        <button type="button" className="btn btn-primary" onClick={createNew} disabled={loading}>
          새 대화 시작하기
        </button>
      </header>

      {error && (
        <div className="chat-error-banner">
          <strong>오류:</strong> {error}
          <button type="button" className="btn btn-ghost" onClick={load}>
            다시 시도
          </button>
        </div>
      )}

      <div className="chat-list">
        {loading && chats.length === 0 && (
          <div className="chat-empty">대화방을 불러오는 중…</div>
        )}

        {!loading && chats.length === 0 && (
          <div className="chat-empty">
            <p>내 대화방이 없습니다.</p>
          </div>
        )}

        {chats.map((c) => (
          <div key={c.id} className="chat-list-item">
            <div className="chat-list-item-main">
              <div className="chat-list-item-title">
                <strong>{c.title || '새 대화'}</strong>
                <span className="chat-list-item-date">{formatDate(c.createdAt)}</span>
              </div>
              {c.lastMessage && (
                <div className="chat-list-item-preview">
                  <span className={`chat-preview-role chat-preview-${c.lastMessage.role}`}>
                    {c.lastMessage.role === 'user' ? '나' : 'Solar'}
                  </span>
                  <span className="chat-list-item-preview-text">{c.lastMessage.content}</span>
                </div>
              )}
            </div>
            <div className="chat-list-item-meta">
              <span className="chat-list-item-count">{c.messageCount}개 메시지</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate(`/chats/${c.id}`)}
              >
                이어가기
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
