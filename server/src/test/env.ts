import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..', '..');

function loadEnvFileIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export const preparedTestEnv = ((): { applied: boolean } => {
  // 1) .env.test가 있으면 선택적으로 불러온다. 파일 부재만으로 실패하지 않는다.
  loadEnvFileIfExists(resolve(projectRoot, 'server', '.env.test'));

  const testDbUrl = process.env.TEST_DATABASE_URL;

  // 2) TEST_DATABASE_URL이 없으면 테스트를 시작하지 않는다.
  if (!testDbUrl) {
    throw new Error(
      '테스트 전용 데이터베이스가 설정되지 않았습니다. ' +
        'TEST_DATABASE_URL 환경변수를 직접 전달하거나 .env.test에 설정하세요. ' +
        '예시: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/mabc_test',
    );
  }

  const currentDbUrl = process.env.DATABASE_URL;
  // 3) 기존 DATABASE_URL과 TEST_DATABASE_URL이 같으면 운영/개발 DB 오염 위험이 있으므로 중단한다.
  if (currentDbUrl && currentDbUrl === testDbUrl) {
    throw new Error(
      'TEST_DATABASE_URL이 현재 DATABASE_URL과 동일합니다. ' +
        '운영/개발 데이터베이스가 오염될 위험이 있으므로 테스트를 중단합니다. ' +
        '테스트 전용 별도 데이터베이스 주소를 사용하세요.',
    );
  }

  // 4) 앱과 Prisma/pg 모듈이 DATABASE_URL을 읽기 전에 TEST_DATABASE_URL로 재정의한다.
  process.env.DATABASE_URL = testDbUrl;

  return { applied: true };
})();
