import { db } from './db';

async function main() {
  try {
    const user = await db.user.count();
    console.log('DB 연결 OK. users 테이블 행 수 =', user);
  } catch (e) {
    console.error('DB 연결 실패:', e);
    process.exit(1);
  }
}

main();
