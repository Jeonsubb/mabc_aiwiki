import { Router, Request, Response } from 'express';
import { db, hashPassword, hashContent } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateFromRecord, type SolarResult } from '../solar';

export const recordsRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

// 원문 → 세그먼트 분할 (개행 기준)
function splitIntoSegments(rawText: string): Array<{ rawStart: number; rawEnd: number; rawText: string }> {
  const lines = rawText.split('\n');
  const segments: Array<{ rawStart: number; rawEnd: number; rawText: string }> = [];
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    segments.push({ rawStart: start, rawEnd: end, rawText: line });
    offset = end + 1; // '\n' 1문자
  }
  return segments;
}

recordsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  try {
    const { rawText, conversationId, source, context } = req.body as {
      rawText?: string;
      conversationId?: string;
      source?: string;
      context?: Record<string, unknown>;
    };
    if (!rawText) {
      return res.status(400).json({ error: 'rawText가 필요' });
    }

    // ── 1. Record 생성 ──────────────────────────────────────────────
    const contentHash = await hashContent(rawText);
    const record = await db.record.create({
      data: {
        userId,
        conversationId: conversationId || `conversation_${Date.now()}`,
        source: source || 'solar_agent_conversation',
        rawText,
        contentHash,
        context: (context && typeof context === 'object' ? context : {}) as import('@prisma/client/runtime/library').InputJsonValue,
        status: '처리중',
      },
    });

    // ── 2. ConversationSegment 생성 ─────────────────────────────────
    const segments = splitIntoSegments(rawText);
    const createdSegments = await db.conversationSegment.createMany({
      data: segments.map((seg, idx) => ({
        recordId: record.id,
        segmentIndex: idx,
        rawStart: seg.rawStart,
        rawEnd: seg.rawEnd,
        rawText: seg.rawText,
      })),
    });

    const segmentIds = (
      await db.conversationSegment.findMany({
        where: { recordId: record.id },
        orderBy: { segmentIndex: 'asc' },
        select: { id: true },
      })
    ).map((s) => s.id);

    // ── 3. 기존 위키 노드 조회 ──────────────────────────────────────
    const existingNodes = await db.wikiNode.findMany({
      where: { userId },
      select: { id: true, title: true, summary: true, content: true, topics: true, tags: true, categories: true },
    });

    // ── 4. generateFromRecord() 호출 ───────────────────────────────
    const solarResult = await generateFromRecord(
      rawText,
      existingNodes,
      segmentIds.length > 0 ? segmentIds : [],
      record.id,
    );

    let recordStatus: string;
    let errorMessage: string | undefined;

    // ── 5. 새 노드 + 버전 생성 ──────────────────────────────────────
    const createdNodes: Array<{ id: string; title: string }> = [];
    const createdProposals: Array<{ id: string; type: string; action: string; reason: string }> = [];

    if (solarResult.status === 'success') {
      recordStatus = '처리됨';

      // 노드 생성
      for (const nodeDraft of solarResult.newNodes) {
        if (!nodeDraft.title) continue;
        const node = await db.wikiNode.create({
          data: {
            userId,
            title: nodeDraft.title,
            summary: nodeDraft.summary,
            content: nodeDraft.content,
            topics: nodeDraft.topics,
            tags: nodeDraft.tags,
            categories: nodeDraft.categories,
            classificationState: nodeDraft.categories.length > 0 ? '후보N개' : '미정',
            classificationCandidates: nodeDraft.categories.length > 0 ? nodeDraft.categories.join(',') : null,
          },
        });

        // v1 버전 생성
        await db.nodeVersion.create({
          data: {
            nodeId: node.id,
            version: 1,
            summary: nodeDraft.summary,
            content: nodeDraft.content,
            topics: nodeDraft.topics,
            tags: nodeDraft.tags,
            categories: nodeDraft.categories,
            changedBy: 'agent',
            changeType: '생성',
            changeNote: 'Solar가 최초 생성함',
          },
        });

        createdNodes.push({ id: node.id, title: node.title });

        // RecordToNode 매핑
        await db.recordToNode.create({
          data: {
            recordId: record.id,
            nodeId: node.id,
            nodeVersionId: null,
            changeDescription: 'Solar가 원문을 기반으로 새 위키 노드 생성',
          },
        });
      }

      // 제안 + 근거 생성
      let skillHash: string | null = null;
      try {
        skillHash = (await import('../solar.js')).computeSkillHash();
      } catch {
        // ignore
      }
      for (const propDraft of solarResult.proposals) {
        if (!propDraft.action && !propDraft.reason) continue;
        const proposal = await db.proposal.create({
          data: {
            userId,
            type: propDraft.type,
            action: propDraft.action,
            reason: propDraft.reason,
            proposalHash: `${record.id}:${propDraft.type}:${propDraft.reason}`,
            evidenceSegmentIds: propDraft.evidenceSegments,
            relatedSegmentIds: propDraft.relatedSegmentIds,
            relatedRecordId: propDraft.relatedRecordId || record.id,
            baseNodeVersion: null,
            skillHash,
            hasSensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
            sensitiveInfoWarning: solarResult.sensitiveInfo.warning || undefined,
            sensitiveInfoNodeIds: solarResult.sensitiveInfo.nodeIds || [],
            status: '제안됨',
            targetNodeId: propDraft.targetNodeId || undefined,
            sourceNodeId: propDraft.sourceNodeId || undefined,
          },
        });

        // ProposalEvidence 생성
        for (const segId of propDraft.evidenceSegments) {
          const seg = await db.conversationSegment.findUnique({ where: { id: segId } });
          if (seg) {
            await db.proposalEvidence.create({
              data: {
                proposalId: proposal.id,
                segmentId: segId,
                quote: seg.rawText,
                originalStart: seg.rawStart,
                originalEnd: seg.rawEnd,
              },
            });
          }
        }

        createdProposals.push({
          id: proposal.id,
          type: proposal.type,
          action: proposal.action,
          reason: proposal.reason,
        });
      }

      // ── 6. 관심사 후보 처리 ──────────────────────────────────────
      for (const cand of solarResult.interestCandidates) {
        if (!cand.interest) continue;
        const tracking = await db.interestTracking.upsert({
          where: { user_interest_unique: { userId, interest: cand.interest } },
          create: {
            userId,
            interest: cand.interest,
            status: '추적중',
            firstDiscoveredAt: new Date(),
            lastDiscoveredAt: new Date(),
          },
          update: {
            lastDiscoveredAt: new Date(),
            status: '추적중',
          },
        });

        await db.interestMention.create({
          data: {
            interestTrackingId: tracking.id,
            recordId: record.id,
            role: 'user',
            mentionedAt: new Date(),
            contextSnippet: cand.snippet || undefined,
            isExplicitMark: false,
          },
        });
      }

      // 민감 정보 플래그 기록
      if (solarResult.sensitiveInfo.hasSensitiveInfo) {
        errorMessage = solarResult.sensitiveInfo.warning
          ? `민감 정보 감지: ${solarResult.sensitiveInfo.warning}`
          : '민감 정보가 포함된 원문입니다';
      }
    } else {
      // Solar 처리 실패
      recordStatus = '실패';
      errorMessage = solarResult.status === 'service_error'
        ? `Solar 서비스 오류: ${solarResult.error?.message || '알 수 없는 오류'}`
        : solarResult.status === 'parse_error'
          ? `Solar 응답 파싱 실패: ${solarResult.error?.message || 'JSON 파싱 오류'}`
          : solarResult.status === 'no_result'
            ? 'Solar 응답이 비어 있음'
            : 'Solar 처리 중 오류 발생';
    }

    // ── 7. Record 상태 갱신 ─────────────────────────────────────────
    await db.record.update({
      where: { id: record.id },
      data: {
        status: recordStatus,
        errorMessage,
      },
    });

    // ── 8. 응답 ────────────────────────────────────────────────────
    return res.status(201).json({
      record: {
        id: record.id,
        status: recordStatus,
        errorMessage,
        createdAt: record.createdAt,
      },
      segments: segmentIds.length,
      nodes: createdNodes,
      proposals: createdProposals,
      interestCandidates: solarResult.interestCandidates.length,
      sensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
    });
  } catch (err) {
    console.error('records POST pipeline error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

recordsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const records = await db.record.findMany({
      where: { userId },
      orderBy: { receivedAt: 'desc' },
      select: {
        id: true,
        conversationId: true,
        source: true,
        rawText: false,
        contentHash: false,
        context: true,
        status: true,
        retryCount: true,
        errorMessage: true,
        receivedAt: true,
        createdAt: true,
      },
    });
    res.json({ records });
  } catch (err) {
    console.error('records GET error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

recordsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const record = await db.record.findFirst({
      where: { id: req.params.id, userId },
      include: {
        segments: { orderBy: { segmentIndex: 'asc' }, select: { id: true, segmentIndex: true, rawText: true } },
      },
    });
    if (!record) {
      return res.status(404).json({ error: '기록을 찾지 못함' });
    }
    res.json({ record });
  } catch (err) {
    console.error('records GET /:id error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
