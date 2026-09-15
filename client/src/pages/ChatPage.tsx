import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { ChatMessage, ChatMessageResponse, ChatRetryResponse } from '@shared/api';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.getChatDetail(id);
        if (!alive) return;
        setTitle(res.chat.title);
        setMessages(res.chat.messages);
        setError(null);

        // 새로고침 후 재시도 가능한 pending 상태만 복원한다.
        // 마지막 메시지가 사용자 메시지면 해당 id로 재시도를 이어갈 수 있게 둔다.
        const msgs = res.chat.messages;
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last.role === 'user') {
            setPendingMessageId(last.id);
          }
        }
      } catch (err) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : '대화방 불러오기 실패';
        setError(msg);
      } finally {
        if (!cancelled) {
          scrollToBottom();
        }
      }
    };

    load();
    return () => {
      alive = false;
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setSendError(null);
    setLoading(true);

    try {
      const res = await api.sendMessage(id!, text);
      if (res.status === 'success') {
        setMessages((prev) => [...prev, res.userMessage!, res.assistantMessage!]);
        setPendingMessageId(null);
      } else {
        // 사용자 메시지는 저장됐지만 AI 답변이 실패한 경우
        setMessages((prev) => [...prev, res.userMessage!]);
        setSendError(res.error || 'AI 답변을 생성하지 못했음');
        setPendingMessageId(res.pendingUserMessageId || null);
      }
    } catch (err) {
      // 전송 자체 실패: 사용자 메시지가 저장되지 않았을 수 있음
      const msg = err instanceof Error ? err.message : '메시지 전송 실패';
      setSendError(msg);
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = useCallback(async () => {
    if (!id || !pendingMessageId || loading) return;
    setLoading(true);
    setSendError(null);

    try {
      const res = await api.retryMessage(id, pendingMessageId);
      if (res.status === 'success') {
        setMessages((prev) => [...prev, res.assistantMessage!]);
        setPendingMessageId(null);
        setSendError(null);
      } else if (res.status === 'already_answered') {
        setPendingMessageId(null);
        setSendError('이미 답변이 있음');
      } else {
        setSendError(res.error || '답변 생성에 실패했음');
        setPendingMessageId(res.pendingUserMessageId || pendingMessageId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '재시도 실패';
      setSendError(msg);
    } finally {
      setLoading(false);
    }
  }, [id, pendingMessageId, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  if (!id) {
    return (
      <div className="container" style={{ paddingTop: 'var(--sp-2xl)' }}>
        <div className="card">
          <p className="hint">잘못된 경로입니다.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/chats')}>
            대화 목록으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <div>
          <h2 className="chat-title">{title || '로드 중…'}</h2>
          <div className="chat-meta">
            {messages.length > 0
              ? `${messages.length}개 메시지`
              : '아직 메시지가 없음'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-xs)' }}>
        <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          try {
            const res = await api.createChat({});
            navigate(`/chats/${res.chat.id}`);
          } catch (err) {
            setSendError(err instanceof Error ? err.message : '대화방 생성 실패');
          }
        }}
      >
        새 대화
      </button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/chats')}>
          목록으로
        </button>
      </div>
      </header>

      <div className="chat-messages">
        {messages.length === 0 && !loading && !error && (
          <div className="chat-empty">
            <p>여기에서 Solar Pro 4와 대화하고, 그 내용을 위키로 정리할 수 있습니다.</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`chat-message chat-message-${m.role}`}>
            <div className="chat-message-avatar">{m.role === 'user' ? 'U' : 'AI'}</div>
            <div className="chat-message-body">
              <div className="chat-message-label">
                {m.role === 'user' ? '나' : 'Solar'}
                <span className="chat-message-time">{formatTime(m.createdAt)}</span>
              </div>
              <div className="chat-message-content">{m.content}</div>
            </div>
          </div>
        ))}

        {error && (
          <div className="chat-error-banner">
            <strong>대화방을 불러오지 못함:</strong> {error}
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/chats')}>
              다른 대화 보기
            </button>
          </div>
        )}

        {pendingMessageId && (
          <div className="chat-pending">
            <div className="chat-message chat-message-user">
              <div className="chat-message-avatar">U</div>
              <div className="chat-message-body">
                <div className="chat-message-label">나</div>
                <div className="chat-message-content">
                  내 메시지는 저장됐지만 AI 답변이 아직 없습니다.
                </div>
              </div>
            </div>

            <div className="chat-retry-card">
              <p className="chat-retry-text">잠시 후에 다시 시도해 보세요.</p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={handleRetry}
              >
                {loading ? '답변 생성 중…' : '다시 시도'}
              </button>
            </div>
          </div>
        )}

        {sendError && !pendingMessageId && (
          <div className="chat-error-banner">
            <strong>오류:</strong> {sendError}
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/chats')}>
              다른 대화 보기
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-input-wrap">
          <textarea
            className="chat-input"
            placeholder="Solar Pro 4에게 말하기…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            rows={3}
            autoFocus
          />
          {loading && (
            <div className="chat-input-sending" aria-hidden="true">
              전송 중…
            </div>
          )}
        </div>
        <div className="chat-input-footer">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || input.trim().length === 0}
          >
            전송
          </button>
          {sendError && (
            <span className="chat-send-error">{sendError}</span>
          )}
        </div>
      </form>
    </div>
  );
}
