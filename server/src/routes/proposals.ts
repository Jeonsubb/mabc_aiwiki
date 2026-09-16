import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { normalizeTags } from '../solar';

export const proposalsRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}
class DecisionConflict extends Error {}

async function claimProposal(
  tx: Prisma.TransactionClient,
  proposalId: string,
  userId: string,
) {
  const claimed = await tx.proposal.updateMany({
    where: { id: proposalId, userId, status: '제안됨' },
    data: { status: '승인됨' },
  });

  if (claimed.count !== 1) {
    throw new DecisionConflict('이 제안은 이미 결정됐습니다');
  }
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
  sourceNode: {
    select: {
      id: true,
      title: true,
      summary: true,
    },
  },
  targetNode: {
    select: {
      id: true,
      title: true,
      summary: true,
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
      include: {
        sourceNode: { select: { id: true, userId: true, tags: true } },
        targetNode: { select: { id: true, userId: true, tags: true } },
      },
    });
    if (!proposal) {
      return res.status(404).json({ error: '제안을 찾지 못함' });
    }

    // 이미 결정된 제안은 재결정 불가
    if (proposal.status === '승인됨' || proposal.status === '기각됨' || proposal.status === '반영됨') {
      return res.status(409).json({ error: `이 제안은 이미 ${proposal.status}로 결정되어 다시 결정할 수 없습니다` });
    }

    // '수락'은 추가 유형만 대상 노드 생성을, 대상 노드 유형은 노드 갱신으로 처리한다.
    const isNewNodeProposal = proposal.type === '추가';
    const isUpdateProposal = proposal.type === '갱신';
    const isLinkProposal = proposal.type === '연결';
    const changePayload = proposal.changePayload;

    if (action === '수락' && !isNewNodeProposal && !isUpdateProposal && !isLinkProposal) {
      return res.status(400).json({ error: '수락할 수 없는 제안 유형입니다' });
    }

    if (action === '수락') {
      if (isNewNodeProposal) {
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
          await claimProposal(tx, proposal.id, userId);
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
      if (isLinkProposal) {
  const sourceNodeId = proposal.sourceNodeId;
  const targetNodeId = proposal.targetNodeId;

  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
    return res.status(400).json({ error: '연결할 두 노드가 유효하지 않습니다' });
  }

  const nodes = await db.wikiNode.findMany({
    where: { id: { in: [sourceNodeId, targetNodeId] } },
    select: { id: true, userId: true, tags: true },
  });

  if (nodes.length !== 2) {
    return res.status(404).json({ error: '연결할 노드를 찾지 못했습니다' });
  }
  if (nodes.some((node) => node.userId !== userId)) {
    return res.status(403).json({ error: '다른 사용자 노드는 연결할 수 없습니다' });
  }

  const payload = changePayload as Record<string, unknown> | null;
  const evidence = typeof payload?.evidence === 'string'
    ? payload.evidence.trim()
    : '';

  if (!evidence) {
    return res.status(400).json({ error: '연결 근거가 없습니다' });
  }

  const rawRelationType = payload?.relationType;
  const relationType =
    typeof rawRelationType === 'string' && rawRelationType.trim()
      ? rawRelationType.trim().slice(0, 40)
      : '연관';

  const rawDescription = payload?.schemaReason;
  const description =
    typeof rawDescription === 'string' && rawDescription.trim()
      ? rawDescription.trim()
      : proposal.action;

  const tags = normalizeTags(payload?.tags);

  if (tags.length === 0) {
    return res.status(400).json({
      error: '연결 태그가 없습니다. 기존 제안을 기각한 뒤 연결 제안을 다시 생성해 주세요.',
    });
  }

    const result = await db.$transaction(async (tx) => {
    await claimProposal(tx, proposal.id, userId);

    // 수락 시점의 최신 노드와 태그를 읽는다.
    const currentNodes = await tx.wikiNode.findMany({
      where: {
        id: { in: [sourceNodeId, targetNodeId] },
        userId,
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        summary: true,
        content: true,
        topics: true,
        tags: true,
        categories: true,
        latestVersion: true,
      },
    });

    if (currentNodes.length !== 2) {
      throw new DecisionConflict(
        '연결할 노드가 변경되었거나 접근할 수 없습니다.',
      );
    }

    // 기존 후보 생성 단계와 동일하게 양방향 중복을 검사한다.
    const existingRelationship = await tx.nodeRelationship.findFirst({
      where: {
        userId,
        OR: [
          { sourceNodeId, targetNodeId },
          {
            sourceNodeId: targetNodeId,
            targetNodeId: sourceNodeId,
          },
        ],
      },
    });

    if (existingRelationship) {
      throw new DecisionConflict(
        '이미 연결된 노드입니다. 제안 목록을 새로고침해 주세요.',
      );
    }

    const connectionTags = normalizeTags(
      tags,
      currentNodes.flatMap((node) => node.tags),
    );

    for (const node of currentNodes) {
      const existingKeys = new Set(
        normalizeTags(node.tags).map((tag) => tag.toLowerCase()),
      );

      const addedTags = connectionTags.filter(
        (tag) => !existingKeys.has(tag.toLowerCase()),
      );

      // 이미 가진 태그는 추가하거나 버전을 올리지 않는다.
      if (addedTags.length === 0) continue;

      const nextTags = [...node.tags, ...addedTags];
      const nextVersion = node.latestVersion + 1;

      const changed = await tx.wikiNode.updateMany({
        where: {
          id: node.id,
          userId,
          latestVersion: node.latestVersion,
        },
        data: {
          tags: nextTags,
          latestVersion: nextVersion,
        },
      });

      if (changed.count !== 1) {
        throw new DecisionConflict(
          '노드가 다른 작업에서 변경됐습니다. 다시 시도해 주세요.',
        );
      }

      await tx.nodeVersion.create({
        data: {
          nodeId: node.id,
          version: nextVersion,
          summary: node.summary,
          content: node.content,
          topics: node.topics,
          tags: nextTags,
          categories: node.categories,
          changedBy: 'user',
          changeType: '연결 태그 추가',
          changeNote:
            `연결 제안 ${proposal.id} 수락: ${addedTags.join(', ')}`,
        },
      });
    }

    const relationship = await tx.nodeRelationship.create({
      data: {
        userId,
        sourceNodeId,
        targetNodeId,
        relationType,
        description,
        evidence,
        tags: connectionTags,
        proposedBy: proposal.id,
        status: '연결됨',
      },
    });

    const updatedProposal = await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        status: '반영됨',
        decisionAction: '수락',
        decisionAt: new Date(),
      },
    });

    return {
      relationship,
      proposal: updatedProposal,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
  return res.json(result);
}

      // 대상 노드가 있는 제안(갱신 등)은 실제 현재 버전과 대조 후 갱신한다.
      const targetNodeId = proposal.targetNodeId;
if (!targetNodeId) {
  return res.status(400).json({ error: '대상 노드가 없습니다' });
}
      const currentNode = await db.wikiNode.findUnique({
        where: { id: targetNodeId },
        select: {
          id: true,
          userId: true,
          title: true,
          summary: true,
          content: true,
          topics: true,
          tags: true,
          categories: true,
          latestVersion: true,
        },
      });

      if (!currentNode) {
        return res.status(404).json({ error: '대상 노드가 존재하지 않습니다' });
      }

      if (currentNode.userId !== userId) {
        return res.status(403).json({ error: '대상 노드가 다른 사용자 소유입니다' });
      }

      const baseVersion = proposal.baseNodeVersion;
if (baseVersion == null) {
  return res.status(400).json({ error: '제안의 기준 노드 버전이 없습니다' });
}
if (currentNode.latestVersion !== baseVersion) {
  return res.status(409).json({
    error: '버전이 변경되어 현재 반영할 수 없습니다',
    currentVersion: currentNode.latestVersion,
    proposalBaseVersion: baseVersion,
  });
}

      if (!changePayload || typeof changePayload !== 'object') {
        return res.status(400).json({ error: '변경 payload가 없어 노드를 갱신할 수 없습니다' });
      }

      const cp = changePayload as Record<string, unknown>;
      const after = cp.after;
      if (!after || typeof after !== 'object') {
        return res.status(400).json({ error: '변경 후 payload가 없어 노드를 갱신할 수 없습니다' });
      }

      const a = after as Record<string, unknown>;
      const nextSummary = String(a.summary ?? currentNode.summary);
      const nextContent = String(a.content ?? currentNode.content);
      const nextTopics = Array.isArray(a.topics) ? a.topics.filter((x): x is string => typeof x === 'string') : currentNode.topics;
      const nextTags = Array.isArray(a.tags) ? a.tags.filter((x): x is string => typeof x === 'string') : currentNode.tags;
      const nextCategories = Array.isArray(a.categories) ? a.categories.filter((x): x is string => typeof x === 'string') : currentNode.categories;

      const nextVersion = currentNode.latestVersion + 1;

      const result = await db.$transaction(async (tx) => {
        await claimProposal(tx, proposal.id, userId);

const changed = await tx.wikiNode.updateMany({
  where: {
    id: currentNode.id,
    userId,
    latestVersion: baseVersion,
  },
  data: {
    summary: nextSummary,
    content: nextContent,
    topics: nextTopics,
    tags: nextTags,
    categories: nextCategories,
    latestVersion: nextVersion,
  },
});

if (changed.count !== 1) {
  throw new DecisionConflict('버전이 변경되어 현재 반영할 수 없습니다');
}

const updatedNode = await tx.wikiNode.findUniqueOrThrow({
  where: { id: currentNode.id },
});

        const nodeVersion = await tx.nodeVersion.create({
          data: {
            nodeId: updatedNode.id,
            version: nextVersion,
            summary: nextSummary,
            content: nextContent,
            topics: nextTopics,
            tags: nextTags,
            categories: nextCategories,
            changedBy: 'user',
            changeType: '갱신',
            changeNote: `제안 반영으로 갱신됨. 제안 버전: ${baseVersion ?? '없음'}`,
          },
        });

        if (proposal.relatedRecordId) {
          await tx.recordToNode.upsert({
  where: {
    recordId_nodeId: {
      recordId: proposal.relatedRecordId,
      nodeId: updatedNode.id,
    },
  },
  create: {
    recordId: proposal.relatedRecordId,
    nodeId: updatedNode.id,
    nodeVersionId: nodeVersion.id,
    changeDescription: '제안 반영으로 노드 갱신',
  },
  update: {
    nodeVersionId: nodeVersion.id,
    changeDescription: '제안 반영으로 노드 갱신',
  },
});
        }

        const updatedProposal = await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            status: '반영됨',
            decisionAction: '수락',
            decisionAt: new Date(),
          },
        });

        return { node: updatedNode, proposal: updatedProposal };
      });

      return res.json({ proposal: result.proposal, node: result.node });
    }

    const updated = await db.$transaction(async (tx) => {
  await claimProposal(tx, proposal.id, userId);

  return tx.proposal.update({
    where: { id: proposal.id },
    data: {
      status: '기각됨',
      decisionAction: '기각',
      decisionAt: new Date(),
    },
  });
});

    res.json({ proposal: updated });
  } catch (err) {
    if (err instanceof DecisionConflict) {
    return res.status(409).json({ error: err.message });
  }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2034'
    ) {
      return res.status(409).json({
        error: '다른 저장 작업과 겹쳤습니다. 잠시 후 다시 수락해 주세요.',
      });
    }
    console.error('proposals decide error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

proposalsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const proposal = await db.proposal.findFirst({
      where: { id: req.params.id },
      select: { id: true, userId: true, status: true },
    });

    if (!proposal) {
      return res.status(404).json({ error: '제안을 찾지 못함' });
    }

    if (proposal.userId !== userId) {
      return res.status(403).json({ error: '다른 사용자의 제안은 삭제할 수 없습니다' });
    }

    if (proposal.status === '제안됨' || proposal.status === '승인됨') {
      return res.status(409).json({ error: '제안됨·승인됨 상태의 제안은 삭제할 수 없습니다' });
    }

    // 반영된 제안은 nodeRelationship.proposedBy 참조를 해제한 뒤 제안만 삭제한다.
    // 이미 반영된 위키노드·버전·관계 자체는 삭제하지 않는다.
    await db.$transaction(async (tx) => {
      if (proposal.status === '반영됨') {
        await tx.nodeRelationship.updateMany({
          where: { proposedBy: proposal.id },
          data: { proposedBy: null },
        });
      }
      await tx.proposal.delete({ where: { id: proposal.id } });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('proposal delete error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
