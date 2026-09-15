import 'dotenv/config';
import { app } from './app';
import { ensureDemoUser } from './db';

async function boot() {
  try {
    const demo = await ensureDemoUser();
    console.log(`데모 계정 준비 완료: ${demo.email} (${demo.userId})`);
  } catch (err) {
    console.error('데모 계정 초기화 실패:', err);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`server running: http://localhost:${port}`);
  });
}

boot();
