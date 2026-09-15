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
      include: {
        evidence: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            segmentId: true,
            quote: true,
            originalStart: true,
            originalEnd: true,
          },
        },
      },
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

    // '수락'은 추가 유형만 허용, 그 외 유형은 400
    if (action === '수락' && proposal.type !== '추가') {
      return res.status(400).json({ error: '추가 유형 제안만 수락(반영)할 수 있습니다' });
    }

    if (action === '수락') {
      const payload = proposal.draftPayload;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'draftPayload가 없어 노드를 생성할 수 없습니다' });
      }

      const p = payload as Record<string, unknown>;
      const title = String(p.title ?? '');
      const summary = String(p.summary ?? '');
      const content = String(p.content ?? '');
      const topics = Array.isArray(p.topics) ? p.topics.filter((x): x is string => typeof x === 'string') : [];
      const tags = Array.isArray(p.tags) ? p.tags.filter((x): x is string => typeof x === 'string') : [];
      const categories = Array.isArray(p.categories) ? p.categories.filter((x): x is string => typeof x === 'string') : [];

      if (!title.trim()) {
        return res.status(400).json({ error: 'draftPayload에 title이 필요합니다' });
      }

      const result = await db.$transaction(async (tx) => {
        const node = await tx.wikiNode.create({
          data: {
            userId,
            title: title.trim(),
            summary,
            content,
            topics,
            tags,
            categories,
            latestVersion: 1,
          },
        });

        const nodeVersion = await tx.nodeVersion.create({
          data: {
            nodeId: node.id,
            version: 1,
            summary,
            content,
            topics,
            tags,
            categories,
            changedBy: 'user',
            changeType: '생성',
          },
        });

        if (proposal.relatedRecordId) {
          await tx.recordToNode.create({
            data: {
              recordId: proposal.relatedRecordId,
              nodeId: node.id,
              nodeVersionId: nodeVersion.id,
              changeDescription: '제안 반영으로 원본 기록과 노드 연결',
            },
          });
        }

        const updatedProposal = await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            status: '반영됨',
            targetNodeId: node.id,
            decisionAction: '수락',
            decisionAt: new Date(),
          },
        });

        return { node, proposal: updatedProposal };
      });

      return res.json({ proposal: result.proposal, node: result.node });
    }

    const updated = await db.proposal.update({
      where: { id: req.params.id },
      data: {
        status: '기각됨',
        decisionAction: '기각',
        decisionAt: new Date(),
      },
    });

    res.json({ proposal: updated });
  } catch (err) {
    console.error('proposals decide error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
