import { createHash, randomBytes } from 'crypto';

/**
 * MCP 연결용 토큰을 발급한다.
 * - 원문은 한 번만 응답에 포함하고 즉시 버린다.
 * - DB에는 SHA-256(hex)만 저장하며, 목록 응답에는 포함하지 않는다.
 */
export function generateMcpToken() {
  const rawBytes = randomBytes(32);
  const rawToken = rawBytes.toString('hex');
  const hashHex = createHash('sha256').update(rawToken).digest('hex');

  return { rawToken, hashHex };
}

export function hashMcpToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
