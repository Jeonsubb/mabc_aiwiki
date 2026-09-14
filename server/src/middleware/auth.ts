import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any).userId;
  if (!userId) {
    return res.status(401).json({ error: '로그인이 필요' });
  }
  (req as any).userId = userId;
  next();
}
