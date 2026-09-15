import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type {
  McpCredentialsListResponse,
  McpCredentialCreateResponse,
  McpCredentialRevokeResponse,
  McpCredentialListItem,
} from '@shared/api';

export default function McpCredentials() {
  const [credentials, setCredentials] = useState<McpCredentialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const mcpUrl = import.meta.env.VITE_MCP_URL || '';
  const mcpUrlConfigured = Boolean(mcpUrl);

  useEffect(() => {
    api
      .listCredentials()
      .then((res) => setCredentials(res.credentials))
      .catch((err) =>
        setError(err instanceof Error ? err.message : '목록 조회 실패'),
      )
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.createCredential(name.trim());
      setRawToken(res.token);
      setCredentials((prev) => {
        const idx = prev.findIndex((c) => c.id === res.credential.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = res.credential;
          return next;
        }
        return [res.credential, ...prev];
      });
      setName('');
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : '토큰 발급 실패',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = async () => {
    if (!rawToken) return;
    setCopyError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopied(true);
    } catch {
      setCopyError('토큰 복사 실패');
    }
  };

  const handleCopyConfig = async () => {
    if (!mcpUrlConfigured || !rawToken) return;
    setCopyError(null);
    setCopied(false);
    const config = JSON.stringify(
      {
        mcpUrl,
        authorization: `Bearer ${rawToken}`,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
    } catch {
      setCopyError('설정 복사 실패');
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setRevokeError(null);
    try {
      await api.revokeCredential(id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setRevokeError(
        err instanceof Error ? err.message : '폐기 실패',
      );
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div>
      
      <div className="section-head">
        <span className="eyebrow">MCP</span>
        <h2>연결 토큰</h2>
        <p className="section-lead">
          MCP 도구 연동에 쓸 Bearer 토큰을 발급하고 관리합니다. 토큰 원문은
          발급 직후 이 페이지에만 표시하며 저장하지 않습니다.
        </p>
      </div>

      {error ? (
        <div className="card" style={{ marginBottom: 'var(--sp-lg)' }}>
          <p className="record-error">목록 조회 오류: {error}</p>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div className="inbox-head">
          <div className="inbox-main">
            <p className="record-title" style={{ margin: 0 }}>
              MCP 서버 주소
            </p>
            <p className="text-mono-eyebrow" style={{ marginTop: 'var(--sp-xs)' }}>
              {mcpUrlConfigured ? mcpUrl : '설정되지 않음'}
            </p>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 'var(--sp-sm)' }}>
          {mcpUrlConfigured
            ? '이 주소는 설정 JSON에만 들어갑니다. 프론트에서 MCP 연결 테스트는 하지 않습니다.'
            : 'VITE_MCP_URL이 설정되지 않았습니다. 설정 JSON 복사는 비활성화됩니다.'}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 'var(--sp-lg)' }}>
        <p className="record-title" style={{ margin: 0 }}>
          토큰 발급
        </p>
        <p className="text-mute" style={{ margin: 'var(--sp-sm) 0' }}>
          이름을 입력하면 새 토큰이 발급됩니다.
        </p>
        <div className="flex gap-sm" style={{ marginTop: 'var(--sp-sm)' }}>
          <input
            className="input"
            placeholder="연결 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
          />
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
          >
            {creating ? '발급 중' : '토큰 발급'}
          </button>
        </div>
        {createError ? (
          <p className="record-error" style={{ marginTop: 'var(--sp-sm)' }}>
            발급 오류: {createError}
          </p>
        ) : null}

        {rawToken ? (
          <div
            className="card"
            style={{
              marginTop: 'var(--sp-md)',
              border: 'var(--border-hairline-strong)',
            }}
          >
            <p className="text-mono-eyebrow" style={{ margin: 0 }}>
              발급된 토큰 (한 번만 표시)
            </p>
            <div className="code-block" style={{ marginTop: 'var(--sp-sm)', wordBreak: 'break-all' }}>
              {rawToken}
            </div>
            <div className="flex gap-sm" style={{ marginTop: 'var(--sp-sm)' }}>
              <button
                className="btn btn-ghost-sm"
                onClick={handleCopyToken}
                disabled={copied}
              >
                {copied ? '복사됨' : '토큰 복사'}
              </button>
              <button
                className="btn btn-ghost-sm"
                onClick={handleCopyConfig}
                disabled={!mcpUrlConfigured || copied}
              >
                {mcpUrlConfigured ? '설정 JSON 복사' : '주소 미설정'}
              </button>
            </div>
            {copyError ? (
              <p className="record-error" style={{ marginTop: 'var(--sp-sm)' }}>
                {copyError}
              </p>
            ) : copied ? (
              <p className="text-success" style={{ marginTop: 'var(--sp-sm)' }}>
                클립보드에 복사했습니다.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <p className="record-title" style={{ margin: 0 }}>
          토큰 목록
        </p>
        {loading ? (
          <p className="hint" style={{ marginTop: 'var(--sp-md)' }}>
            불러오는 중...
          </p>
        ) : credentials.length === 0 ? (
          <p className="hint" style={{ marginTop: 'var(--sp-md)' }}>
            아직 발급된 토큰이 없습니다.
          </p>
        ) : (
          <ul style={{ margin: 'var(--sp-md) 0 0', padding: 0, listStyle: 'none' }}>
            {credentials.map((c) => {
              const revoked = c.revokedAt !== null;
              return (
                <li
                  key={c.id}
                  className="card"
                  style={{
                    marginBottom: 'var(--sp-sm)',
                    opacity: revoked ? 0.6 : 1,
                  }}
                >
                  <div className="flex justify-between items-center gap-sm">
                    <div>
                      <p className="record-title" style={{ margin: 0 }}>
                        {c.name}
                      </p>
                      <p className="meta-row">발급: {c.createdAt}</p>
                      {revoked ? (
                        <p className="meta-row">폐기: {c.revokedAt}</p>
                      ) : (
                        <span className="badge badge-status-success">활성</span>
                      )}
                    </div>
                    <div className="flex gap-xs">
                      {revoked ? (
                        <span className="badge badge-status-error">폐기됨</span>
                      ) : (
                        <button
                          className="btn btn-danger"
                          onClick={() => handleRevoke(c.id)}
                          disabled={revokingId === c.id}
                        >
                          {revokingId === c.id ? '폐기 중' : '폐기'}
                        </button>
                      )}
                    </div>
                  </div>
                  {revokeError ? (
                    <p className="record-error" style={{ marginTop: 'var(--sp-sm)' }}>
                      폐기 오류: {revokeError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
