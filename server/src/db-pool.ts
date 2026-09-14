import pg from 'pg';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL이 설정되지 않았습니다. ' +
        'docker로 띄운 mabc-postgres 기준 예시: ' +
        'postgres://mabc:mabc-local-dev@localhost:5434/mabc'
    );
  }
  return url;
}

const pool = new pg.Pool({
  connectionString: getDatabaseUrl(),
});

export { pool };
