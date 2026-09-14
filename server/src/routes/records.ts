import { Router, Request, Response } from 'express';
import { db, hashContent } from '../db';
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
    offset = end + 1;
  }
  return segments;
}

// ── GET: 로그인한 사용자의 보관된 대화 기록 (최신순)
recordsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  const records = await db.record.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      conversationId: true,
      rawText: true,
      context: true,
      status: true,
      createdAt: true,
    },
  });

  const mapped = records.map((record) => ({
    id: record.id,
    session_id: record.conversationId,
    stored_at: record.createdAt.toISOString(),
    conversation_text: record.rawText,
    context: (record.context as Record<string, unknown>) ?? {},
    status: record.status,
  }));

  res.json({ records: mapped });
});

// ── 위키 엔진 처리: POST (원문 → Record → Segment → Solar → Node/Proposal/Evidence) ──
recordsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  let recordId: string | undefined;
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

    // 1. Record 생성 (status: 처리중, contentHash: 솔트 없는 SHA-256)
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

    recordId = record.id;

    // 2. ConversationSegment 생성 (없으면 원문 전체를 1개 세그먼트로)
    const segments = splitIntoSegments(rawText);
    const effectiveSegments = segments.length > 0 ? segments : [{ rawStart: 0, rawEnd: rawText.length, rawText }];
    await db.conversationSegment.createMany({
      data: effectiveSegments.map((seg, idx) => ({
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

    // 3. 기존 위키 노드 조회
    const existingNodes = await db.wikiNode.findMany({
      where: { userId },
      select: { id: true, title: true, summary: true, content: true, topics: true, tags: true, categories: true },
    });

    // 4. generateFromRecord() 호출
    const solarResult = await generateFromRecord(
      rawText,
      existingNodes,
      segmentIds,
      record.id,
    );

    let recordStatus: string;
    let errorMessage: string | undefined;

    const createdProposals: Array<{ id: string; type: string; action: string; reason: string }> = [];

    if (solarResult.status === 'success') {
      recordStatus = '처리됨';

      // ── 새 위키 노드 후보는 확정 생성하지 않고, "새 위키 노드 생성 제안" Proposal로만 저장 ──
      let skillHash: string | null = null;
      try {
        skillHash = (await import('../solar.js')).computeSkillHash();
      } catch {}

      for (const nodeDraft of solarResult.newNodes) {
        if (!nodeDraft.title) continue;

        // 새 위키 노드 생성 제안 Proposal
        const newNodeProposal = await db.proposal.create({
          data: {
            userId,
            type: '추가',
            action: `새 위키 노드 생성 제안: ${nodeDraft.title}`,
            reason: nodeDraft.summary
              ? `Solar가 원문 기반으로 새 위키 노드 후보를 제안함. 요약: ${nodeDraft.summary}`
              : 'Solar가 원문 기반으로 새 위키 노드 후보를 제안함.',
            proposalHash: `${record.id}:추가:${nodeDraft.title}:${nodeDraft.summary}`,
            evidenceSegmentIds: segmentIds,
            relatedSegmentIds: segmentIds,
            relatedRecordId: record.id,
            baseNodeVersion: null,
            skillHash,
            hasSensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
            sensitiveInfoWarning: solarResult.sensitiveInfo.warning || undefined,
            sensitiveInfoNodeIds: solarResult.sensitiveInfo.nodeIds || [],
            status: '제안됨',
            targetNodeId: undefined,
            sourceNodeId: undefined,
          },
        });

        // 신규 노드 초안 내용을 evidence로 남김
        for (const segId of segmentIds) {
          const seg = await db.conversationSegment.findUnique({ where: { id: segId } });
          if (seg) {
            await db.proposalEvidence.create({
              data: {
                proposalId: newNodeProposal.id,
                segmentId: segId,
                quote: seg.rawText,
                originalStart: seg.rawStart,
                originalEnd: seg.rawEnd,
              },
            });
          }
        }

        createdProposals.push({
          id: newNodeProposal.id,
          type: newNodeProposal.type,
          action: newNodeProposal.action,
          reason: newNodeProposal.reason,
        });
      }

      // 기존 제안 + 근거 생성
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

      // 관심사 후보 처리
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

      if (solarResult.sensitiveInfo.hasSensitiveInfo) {
        errorMessage = solarResult.sensitiveInfo.warning
          ? `민감 정보 감지: ${solarResult.sensitiveInfo.warning}`
          : '민감 정보가 포함된 원문입니다';
      }
    } else {
      recordStatus = '실패';
      errorMessage = solarResult.status === 'service_error'
        ? `Solar 서비스 오류: ${solarResult.error?.message || '알 수 없는 오류'}`
        : solarResult.status === 'parse_error'
          ? `Solar 응답 파싱 실패: ${solarResult.error?.message || 'JSON 파싱 오류'}`
          : solarResult.status === 'no_result'
            ? 'Solar 응답이 비어 있음'
            : 'Solar 처리 중 오류 발생';
    }

    // 5. Record 상태 갱신
    await db.record.update({
      where: { id: record.id },
      data: {
        status: recordStatus,
        errorMessage,
      },
    });

    return res.status(201).json({
      record: {
        id: record.id,
        status: recordStatus,
        errorMessage,
        createdAt: record.createdAt,
      },
      segments: segmentIds.length,
      proposals: createdProposals,
      interestCandidates: solarResult.interestCandidates.length,
      sensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
    });
  } catch (err) {
    console.error('records POST pipeline error:', err);
    // 이미 생성된 record가 있으면 상태를 '실패'로 갱신
    if (recordId) {
      try {
        await db.record.update({
          where: { id: recordId },
          data: { status: '실패', errorMessage: String((err as Error).message ?? '알 수 없는 오류') },
        });
      } catch (updateErr) {
        console.error('records POST pipeline - record 실패 갱신 오류:', updateErr);
      }
    }
    return res.status(500).json({ error: '서버 오류' });
  }
});
