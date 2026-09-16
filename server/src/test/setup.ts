import { beforeAll, afterAll } from 'vitest';
import { getTestPrismaClient } from './client';
import { preparedTestEnv } from './env';
import { pool as pgPool } from '../db-pool';

// setupFiles는 테스트 파일 실행 전에 실행된다.
// 여기서 환경 준비와 공유 PrismaClient 생성·연결을 수행한다.
// app 모듈은 여기서 import하지 않는다.
// health.test.ts에서 DATABASE_URL이 이미 재지정된 후에 app을 import해야
// 기존 DATABASE_URL로 pg Pool/Prisma가 먼저 생성되지 않는다.

beforeAll(async () => {
  const prisma = getTestPrismaClient();
  await prisma.$connect();
});

afterAll(async () => {
  // 테스트 PrismaClient 종료
  const prisma = getTestPrismaClient();
  await prisma.$disconnect();

  // pg Pool 종료 (앱의 db-pool.ts)
  await pgPool.end();
});
