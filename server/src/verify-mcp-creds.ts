import 'dotenv/config';
import { db } from './db';
import { generateMcpToken } from './util/mcp-token';

(async () => {
  try {
    const email = process.env.DEMO_EMAIL || 'demo@mabc.local';
    const password = (process.env.DEMO_PASSWORD || 'demo1234').toString();

    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      console.log('데모 사용자가 없어서 먼저 생성합니다.');
      user = await db.user.create({
        data: {
          email,
          name: '데모 사용자',
          passwordHash: password,
          role: 'demo',
        },
      });
      console.log('데모 사용자 생성 완료:');
      console.log('ID:', user.id);
      console.log('이메일:', user.email);
    } else {
      console.log('데모 사용자 존재:');
      console.log('ID:', user.id);
      console.log('이메일:', user.email);
    }

    const creds = await db.mcpCredential.findMany({
      where: { revokedAt: null },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log('\nMCP Credentials (최근순):');
    if (creds.length === 0) {
      console.log('없음: 유효한 MCP Credential 없음');
    }
    creds.forEach((c) => {
      console.log(JSON.stringify({ id: c.id, name: c.name, createdAt: c.createdAt.toISOString() }));
    });

    if (creds.length === 0) {
      const { rawToken, hashHex } = generateMcpToken();
      const created = await db.mcpCredential.create({
        data: { userId: user.id, name: 'verify-test', tokenHash: hashHex },
      });
      console.log('\n테스트용 MCP Credential 생성 완료:');
      console.log('ID:', created.id);
      console.log('이름:', created.name);
      console.log('RAW_TOKEN(이번만 사용):', rawToken);
      console.log('주의: rawToken은 응답에 한 번만 출력되며 이후에는 조회할 수 없음');
    } else {
      console.log('\n기존 Credential 사용 권장 (테스트용 rawToken 재발급 안 함)');
    }
  } catch (e: unknown) {
    console.error('DB 오류:', e instanceof Error ? e.message : String(e));
  } finally {
    await db.$disconnect();
  }
})().catch((e: unknown) => {
  console.error('boot error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
