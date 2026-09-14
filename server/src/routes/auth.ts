import { Router, Request, Response } from 'express';
import { db, hashPassword, verifyPassword } from '../db';

export const authRouter = Router();

// ---------- 회원가입 ----------
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body as {
      email?: string;
      name?: string;
      password?: string;
    };
    if (!email || !password) {
      return res.status(400).json({ error: 'email과 password가 필요' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password는 6자 이상' });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: '이미 가입된 이메일' });
    }

    const passwordHash = await hashPassword(password);
    const created = await db.user.create({
      data: {
        email: normalizedEmail,
        name: name || normalizedEmail.split('@')[0],
        passwordHash,
        role: 'user',
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.status(201).json({ user: created });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ---------- 로그인 ----------
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'email과 password가 필요' });
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 틀림' });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 틀림' });
    }

    req.session.userId = user.id;
    req.session.email = user.email;

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ---------- 로그아웃 ----------
authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('session destroy error:', err);
      return res.status(500).json({ error: '로그아웃 중 오류' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ---------- 내 정보 ----------
authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요' });
  }
  res.json({ user: { id: req.session.userId, email: req.session.email } });
});
