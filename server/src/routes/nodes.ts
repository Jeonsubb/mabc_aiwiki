import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

export const nodesRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

nodesRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const nodes = await db.wikiNode.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ nodes });
  } catch (err) {
    console.error('nodes GET error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

nodesRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const node = await db.wikiNode.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!node) {
      return res.status(404).json({ error: '노드를 찾지 못함' });
    }
    res.json({ node });
  } catch (err) {
    console.error('nodes GET /:id error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
