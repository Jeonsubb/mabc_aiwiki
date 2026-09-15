import { Router, Request, Response } from 'express';
import { db, hashContent } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateCandidatesForRecord, type CandidateGenerationResult } from '../services/candidateGenerator';

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

    // 4. 위키 후보 생성 서비스 호출 (userid + 기존 recordid 기반)
    const candidateResult = await generateCandidatesForRecord(userId, record.id);

    let recordStatus: string;
    let errorMessage: string | undefined;

    const createdProposals = candidateResult.proposals;

    if (candidateResult.status === 'success') {
      recordStatus = '처리됨';

      if (candidateResult.sensitiveInfo.hasSensitiveInfo) {
        errorMessage =
          candidateResult.sensitiveInfo.warning
            ? `민감 정보 감지: ${candidateResult.sensitiveInfo.warning}`
            : '민감 정보가 포함된 원문입니다';
      }
    } else {
      recordStatus = '실패';
      errorMessage =
        candidateResult.status === 'service_error'
          ? candidateResult.error || 'Solar 서비스 오류'
          : candidateResult.status === 'parse_error'
            ? candidateResult.error || 'Solar 응답 파싱 실패'
            : candidateResult.status === 'no_result'
              ? 'Solar 응답이 비어 있음'
              : candidateResult.error || 'Solar 처리 중 오류 발생';
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
      interestCandidates: candidateResult.interestCandidatesCount,
      sensitiveInfo: candidateResult.sensitiveInfo.hasSensitiveInfo,
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
