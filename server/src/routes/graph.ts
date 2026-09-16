import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { normalizeTags } from '../solar';

export const graphRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

graphRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

    const [nodes, relationships, suggestions] = await Promise.all([
      db.wikiNode.findMany({
        where: {
          userId,
          status: '활성',
        },
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          summary: true,
          topics: true,
          tags: true,
          updatedAt: true,
        },
      }),

      db.nodeRelationship.findMany({
        where: {
          userId,
          status: '연결됨',
        },
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          relationType: true,
          description: true,
          evidence: true,
          tags: true,
          createdAt: true,
        },
      }),

      db.proposal.findMany({
        where: {
          userId,
          type: '연결',
          status: '제안됨',
          sourceNodeId: { not: null },
          targetNodeId: { not: null },
        },
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          action: true,
          reason: true,
          changePayload: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      nodes,
      edges: relationships.map((relationship) => ({
        id: relationship.id,
        source: relationship.sourceNodeId,
        target: relationship.targetNodeId,
        relationType: relationship.relationType,
        description: relationship.description,
        evidence: relationship.evidence,
        tags: normalizeTags(relationship.tags),
        status: 'confirmed',
        createdAt: relationship.createdAt,
      })),
      suggestedEdges: suggestions.map((proposal) => ({
        proposalId: proposal.id,
        source: proposal.sourceNodeId,
        target: proposal.targetNodeId,
        description: proposal.action,
        reason: proposal.reason,
        evidence:
          proposal.changePayload &&
          typeof proposal.changePayload === 'object' &&
          'evidence' in proposal.changePayload
            ? String(proposal.changePayload.evidence ?? '')
            : '',
        tags: normalizeTags(
          proposal.changePayload &&
          typeof proposal.changePayload === 'object' &&
          'tags' in proposal.changePayload
            ? proposal.changePayload.tags
            : [],
        ),
        status: 'suggested',
        createdAt: proposal.createdAt,
      })),
    });
  } catch (error) {
    console.error('graph GET error:', error);
    res.status(500).json({ error: '그래프를 불러오지 못했습니다' });
  }
});