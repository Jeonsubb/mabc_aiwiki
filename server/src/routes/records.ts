import { Router, Request, Response } from 'express';
import { db, hashPassword, hashContent } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateFromRecord, type SolarResult } from '../solar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const recordsRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

// ── MCP conversations.json 읽기 ──────────────────────────────────
function conversationsPath(): string {
  const env = process.env.MABC_MCP_STORE;
  if (env) {
    return path.join(env, 'conversations.json');
  }
  return path.join(os.homedir(), '.mabc-mcp-store', 'conversations.json');
}

function readConversations(): Array<{
  id: string;
  session_id: string;
  stored_at: string;
  conversation_text: string;
  context: Record<string, unknown>;
}> {
  const p = conversationsPath();
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as Array<{
      id: string;
      session_id: string;
      stored_at: string;
      conversation_text: string;
      context: Record<string, unknown>;
    }>;
  } catch {
    return [];
  }
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

// ── MCP conversations.json → GET (통로: MCP에서 저장된 대화 읽기) ──
recordsRouter.get('/', (_req: Request, res: Response) => {
  const conversations = readConversations();
  res.json({ records: conversations });
});

// ── 위키 엔진 처리: POST (원문 → Record → Segment → Solar → Node/Proposal/Evidence) ──
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

    const createdNodes: Array<{ id: string; title: string }> = [];
    const createdProposals: Array<{ id: string; type: string; action: string; reason: string }> = [];

    if (solarResult.status === 'success') {
      recordStatus = '처리됨';

      // 새 노드 + 버전 생성
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
      } catch {}

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
          where: { userId_interest: { userId, interest: cand.interest } },
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
