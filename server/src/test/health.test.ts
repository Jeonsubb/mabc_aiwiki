import { beforeAll, afterAll, expect, test } from 'vitest';
import request from 'supertest';

// ------------------------------------------------------------------
// 1) 환경 준비
//    setup.ts가 setupFiles로 먼저 실행되며,
//    .env.test(선택) → TEST_DATABASE_URL 검증 → DATABASE_URL 재지정
//    까지 끝난다. 이 시점 이후에야 앱/Prisma/pg 모듈이 로드되어야
//    기존 DATABASE_URL로 pg Pool이나 PrismaClient가 먼저 생성되지 않는다.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// 2) 공유 PrismaClient
//    테스트 전체에서 쓰이며, setup.ts가 beforeAll에서 연결하고
//    afterAll에서 disconnect한다.
// ------------------------------------------------------------------
import { getTestPrismaClient } from './client';

// ------------------------------------------------------------------
// 3) 앱 모듈은 DATABASE_URL이 재지정된 뒤에만 import
// ------------------------------------------------------------------
let app: Express.Application;

beforeAll(async () => {
  // setup.ts가 이미 DATABASE_URL을 TEST_DATABASE_URL로 바꿔 둔 뒤이므로,
  // 여기서 import하면 app.ts → db-pool.ts의 pg Pool과 PrismaClient도
  // 테스트 DB를 바라보게 된다.
  const mod = await import('../app');
  app = mod.app as Express.Application;
});

afterAll(async () => {
  // 테스트 PrismaClient 종료 (setup.ts에서 이미 닫지만,
  // 안전성을 위해 여기서도 명시적 종료)
  const prisma = getTestPrismaClient();
  await prisma.$disconnect();

  // 앱의 PrismaClient(db.ts의 db)도 종료
  const dbMod = await import('../db');
  const db = (dbMod as { db: import('@prisma/client').PrismaClient }).db;
  await db.$disconnect();

  // PostgreSQL session pool 종료 (db-pool.ts)
  const poolMod = await import('../db-pool');
  await poolMod.pool.end();
});

test('GET /api/health는 200과 ok: true를 반환한다', async () => {
  const res = await request(app).get('/api/health');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
