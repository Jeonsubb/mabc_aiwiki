import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

export const proposalsRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

proposalsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const proposals = await db.proposal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ proposals });
  } catch (err) {
    console.error('proposals GET error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

proposalsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const proposal = await db.proposal.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!proposal) {
      return res.status(404).json({ error: '제안을 찾지 못함' });
    }
    res.json({ proposal });
  } catch (err) {
    console.error('proposals GET /:id error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

proposalsRouter.post('/:id/decide', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { action } = req.body as { action?: '수락' | '기각' };
    if (action !== '수락' && action !== '기각') {
      return res.status(400).json({ error: 'action은 수락 또는 기각이어야 합니다' });
    }

    const proposal = await db.proposal.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!proposal) {
      return res.status(404).json({ error: '제안을 찾지 못함' });
    }

    // 이미 결정된 제안은 재결정 불가
    if (proposal.status === '승인됨' || proposal.status === '기각됨' || proposal.status === '반영됨') {
      return res.status(409).json({ error: `이 제안은 이미 ${proposal.status}로 결정되어 다시 결정할 수 없습니다` });
    }

    const nextStatus = action === '수락' ? '승인됨' : '기각됨';
    const updated = await db.proposal.update({
      where: { id: req.params.id },
      data: {
        status: nextStatus,
        decisionAction: action,
        decisionAt: new Date(),
      },
    });

    res.json({ proposal: updated });
  } catch (err) {
    console.error('proposals decide error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
