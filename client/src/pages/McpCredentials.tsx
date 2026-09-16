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
  const [tokenCopied, setTokenCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [deletingInProgressId, setDeletingInProgressId] = useState<string | null>(null);

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
    setTokenCopied(false);
    try {
      await navigator.clipboard.writeText(rawToken);
      setTokenCopied(true);
    } catch {
      setCopyError('토큰 복사 실패');
    }
  };

  const handleCopyConfig = async () => {
    if (!mcpUrlConfigured || !rawToken) return;

    setCopyError(null);
    setConfigCopied(false);

    const config = JSON.stringify(
      {
        mcpServers: {
          nodus: {
            description: 'Nodus AI Wiki MCP',
            url: mcpUrl,
            headers: {
              Authorization: `Bearer ${rawToken}`,
            },
          },
        },
      },
      null,
      2,
    );

    try {
      await navigator.clipboard.writeText(config);
      setConfigCopied(true);
    } catch {
      setCopyError('설정 JSON 복사 실패');
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

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setDeleteErrorId(null);
    setDeletingInProgressId(id);
    try {
      await api.deleteCredential(id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setDeleteErrorId(id);
    } finally {
      setDeletingId(null);
      setDeletingInProgressId(null);
    }
  };

  return (
    <div className="container">
      
      <div className="section-head">
        <span className="eyebrow">MCP</span>
        <h2>MCP 연결</h2>
        <p className="section-lead">
          타임리에 MCP 서버 주소와 토큰을 등록하면, 대화 중 위키 저장을 요청할 수 있습니다.
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
                disabled={tokenCopied}
              >
                {tokenCopied ? '복사됨' : '토큰 복사'}
              </button>
              <button
                className="btn btn-ghost-sm"
                onClick={handleCopyConfig}
                disabled={!mcpUrlConfigured || configCopied}
              >
               {mcpUrlConfigured ? '연결 정보 복사' : '주소 미설정'}
              </button>
            </div>
            {copyError ? (
              <p className="record-error" style={{ marginTop: 'var(--sp-sm)' }}>
                {copyError}
              </p>
            ) : tokenCopied || configCopied ? (
              <p className="text-success" style={{ marginTop: 'var(--sp-sm)' }}>
                클립보드에 복사했습니다.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="card" style={{ marginBottom: 'var(--sp-lg)' }}>
  <p className="record-title" style={{ margin: 0 }}>
    타임리에서 연결하는 방법
  </p>

  <ol
    style={{
      margin: 'var(--sp-md) 0 0',
      paddingLeft: '1.25rem',
      lineHeight: 1.8,
    }}
  >
    <li>
      위에서 연결 이름을 입력하고 <strong>토큰 발급</strong>을 누르세요.
    </li>
    <li>
      발급된 토큰과 MCP 서버 주소를 복사하세요.
    </li>
    <li>
      타임리의 <strong>설정 → MCP 서버 → 서버 추가</strong>로 이동하세요.
    </li>
    <li>
      연결 방식으로 <strong>HTTP MCP</strong> 또는{' '}
      <strong>Streamable HTTP</strong>를 선택하세요.
    </li>
    <li>
      서버 주소와 인증 정보를 아래와 같이 입력하세요.
    </li>
  </ol>

  <div
    className="code-block"
    style={{
      marginTop: 'var(--sp-md)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}
  >
    {`서버 주소
${mcpUrlConfigured ? mcpUrl : 'VITE_MCP_URL 설정 필요'}

인증 헤더
Authorization: Bearer ${rawToken ?? '발급받은 토큰'}`}
  </div>

  <p className="hint" style={{ marginTop: 'var(--sp-md)' }}>
    연결한 뒤 타임리에서 “이 대화를 내 위키에 저장해줘”라고 요청하세요.
  </p>

  <div
    className="code-block"
    style={{
      marginTop: 'var(--sp-sm)',
      whiteSpace: 'pre-wrap',
    }}
  >
    타임리에서 저장 요청 → 유입 기록 보관 → 위키 제안 생성 → 사용자
    수락 → 내 위키 반영
  </div>

  <p className="record-error" style={{ marginTop: 'var(--sp-md)' }}>
    토큰은 발급 직후 한 번만 표시됩니다. 비밀번호처럼 안전하게
    보관하세요.
  </p>
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
                    {revoked && (
                      <div className="flex gap-xs">
                        {deletingId === c.id ? (
                          <div className="delete-confirm">
                            <p className="delete-confirm-text">
                              이 토큰은 목록에서 완전히 삭제됩니다. 다시 복구할 수 없습니다.
                            </p>
                            <div className="delete-confirm-actions">
                              <button
                                className="btn btn-danger"
                                onClick={() => handleDelete(c.id)}
                                disabled={deletingInProgressId === c.id}
                              >
                                {deletingInProgressId === c.id ? '삭제 중' : '삭제'}
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={() => setDeletingId(null)}
                              >
                                취소
                              </button>
                            </div>
                            {deleteErrorId === c.id && (
                              <p className="record-error" style={{ marginTop: 'var(--sp-sm)' }}>
                                삭제 실패
                              </p>
                            )}
                          </div>
                        ) : (
                          <button
                            className="btn btn-ghost-sm"
                            onClick={() => setDeletingId(c.id)}
                          >
                            목록에서 삭제
                          </button>
                        )}
                      </div>
                    )}
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
