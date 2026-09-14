import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __db: PrismaClient | undefined;
}

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const db = globalThis.__db ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__db = db;
}

export interface DemoUserResult {
  email: string;
  userId: string;
}

function getHasher() {
  const encoder = new TextEncoder();

  async function hashPassword(plain: string): Promise<string> {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const saltBase64 = btoa(String.fromCharCode(...saltBytes));

    const msgUint8 = encoder.encode(plain + saltBase64);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return `sha256$${saltBase64}$${hashHex}`;
  }

  async function verifyPassword(plain: string, stored: string): Promise<boolean> {
    if (!stored.startsWith('sha256$')) return false;
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, saltBase64, expectedHash] = parts;

    const msgUint8 = encoder.encode(plain + saltBase64);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return hashHex === expectedHash;
  }

  // 콘텐츠 중복 감지용 (솔트 없음) — 동일 원문이면 항상 동일 해시
  async function hashContent(text: string): Promise<string> {
    const msgUint8 = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `content_sha256$${hashHex}`;
  }

  return { hashPassword, verifyPassword, hashContent };
}

const { hashPassword, verifyPassword, hashContent } = getHasher();

export { hashPassword, verifyPassword, hashContent };

// 데모 계정 초기화 (서버 시작 시 1회)
export async function ensureDemoUser(): Promise<DemoUserResult> {
  const email = process.env.DEMO_EMAIL || 'demo@mabc.local';
  const passwordHash = process.env.DEMO_PASSWORD
    ? await hashPassword(process.env.DEMO_PASSWORD)
    : await hashPassword('demo1234');

  const existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    const created = await db.user.create({
      data: {
        email,
        name: '데모 사용자',
        passwordHash,
        role: 'demo',
      },
    });
    return { email, userId: created.id };
  }
  return { email, userId: existing.id };
}
