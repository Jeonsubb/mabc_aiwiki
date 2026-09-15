import { db } from '../db';
import { generateFromRecord, type SolarResult } from '../solar';

export interface CandidateGenerationResult {
  status: SolarResult['status'];
  proposals: Array<{ id: string; type: string; action: string; reason: string }>;
  interestCandidatesCount: number;
  sensitiveInfo: SolarResult['sensitiveInfo'];
  error?: string;
  excluded: Array<{ source: 'newNode' | 'proposal'; reason: string }>;
}

const VALID_PROPOSAL_TYPES = ['추가', '갱신', '분리', '병합', '연결', '보강', '수정'] as const;

function validateNewNodeDraft(
  nodeDraft: {
    title?: unknown;
    summary?: unknown;
    content?: unknown;
    topics?: unknown[];
    tags?: unknown[];
    categories?: unknown[];
  },
  recordSegmentIdSet: Set<string>,
  segments: Array<{ id: string; rawStart: number; rawEnd: number }>,
): { ok: boolean; reason?: string } {
  if (!nodeDraft.title) {
    return { ok: false, reason: '새 위키 노드 초안에 title이 없음' };
  }
  if (segments.length === 0) {
    return { ok: false, reason: '이번 기록에 세그먼트가 없어 새 위키 노드 초안 근거를 특정할 수 없음' };
  }
  for (const seg of segments) {
    if (!recordSegmentIdSet.has(seg.id)) {
      return { ok: false, reason: '새 위키 노드 초안의 근거 세그먼트가 이번 기록의 세그먼트가 아님' };
    }
  }
  return { ok: true };
}

function validateProposalDraft(
  propDraft: {
    type?: unknown;
    targetNodeId?: string | null;
    sourceNodeId?: string | null;
    action?: unknown;
    reason?: unknown;
    evidenceSegments?: string[];
    relatedSegmentIds?: string[];
    relatedRecordId?: string | null;
  },
  recordSegmentIdSet: Set<string>,
  existingNodesById: Map<string, { id: string; userId: string }>,
  userId: string,
): { ok: boolean; reason?: string; targetNode: { id: string; userId: string } | null } {
  const type = propDraft.type;
  if (!type || !VALID_PROPOSAL_TYPES.includes(type as (typeof VALID_PROPOSAL_TYPES)[number])) {
    return { ok: false, reason: `proposal type이 유효하지 않음: ${type ?? '없음'}`, targetNode: null };
  }
  if (!propDraft.action || !propDraft.reason) {
    return { ok: false, reason: 'proposal 초안 중 action 또는 reason이 비어 있음', targetNode: null };
  }
  let targetNode: { id: string; userId: string } | null = null;
  if (propDraft.targetNodeId) {
    const targetNodeCandidate = existingNodesById.get(propDraft.targetNodeId);
    if (!targetNodeCandidate) {
      return { ok: false, reason: `targetNodeId가 존재하지 않음: ${propDraft.targetNodeId}`, targetNode: null };
    }
    if (targetNodeCandidate.userId !== userId) {
      return { ok: false, reason: `targetNodeId가 다른 사용자 소유임: ${propDraft.targetNodeId}`, targetNode: null };
    }
    targetNode = targetNodeCandidate;
  }
  const evidenceSegments = propDraft.evidenceSegments ?? [];
  if (evidenceSegments.length === 0) {
    return { ok: false, reason: 'evidenceSegments가 비어 있어 근거를 특정할 수 없음', targetNode };
  }
  for (const segId of evidenceSegments) {
    if (!recordSegmentIdSet.has(segId)) {
      return { ok: false, reason: `evidenceSegments에 이번 기록의 segment가 아닌 id 포함: ${segId}`, targetNode };
    }
  }
  const relatedSegmentIds = propDraft.relatedSegmentIds ?? [];
  for (const segId of relatedSegmentIds) {
    if (!recordSegmentIdSet.has(segId)) {
      return { ok: false, reason: `relatedSegmentIds에 이번 기록의 segment가 아닌 id 포함: ${segId}`, targetNode };
    }
  }
  return { ok: true, targetNode };
}

/**
 * userid + 기존 recordid로 해당 사용자의 record/segment/기존 노드를 조회한 뒤
 * Solar를 호출해 위키 후보( Proposal / interest 후보 )를 생성한다.
 * 원본 record는 새로 만들지 않고, 이미 저장된 record를 기준으로만 동작한다.
 */
export async function generateCandidatesForRecord(
  userId: string,
  recordId: string,
): Promise<CandidateGenerationResult> {
  const record = await db.record.findUnique({
    where: { id: recordId },
    include: {
      segments: {
        orderBy: { segmentIndex: 'asc' },
        select: {
          id: true,
          rawText: true,
          rawStart: true,
          rawEnd: true,
        },
      },
    },
  });

  if (!record) {
    return {
      status: 'no_result',
      proposals: [],
      interestCandidatesCount: 0,
      sensitiveInfo: { hasSensitiveInfo: false },
      excluded: [],
      error: '대상 record를 찾을 수 없음',
    };
  }

  if (record.userId !== userId) {
    return {
      status: 'no_result',
      proposals: [],
      interestCandidatesCount: 0,
      sensitiveInfo: { hasSensitiveInfo: false },
      excluded: [],
      error: '권한 없음',
    };
  }

  const segments = record.segments.map((s) => ({
    id: s.id,
    rawText: s.rawText,
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
  }));

  const existingNodes = await db.wikiNode.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      title: true,
      summary: true,
      content: true,
      topics: true,
      tags: true,
      categories: true,
    },
  });

  const recordSegmentIdSet = new Set(segments.map((s) => s.id));
  const existingNodesById = new Map(existingNodes.map((n) => [n.id, { id: n.id, userId: n.userId }]));
  const excluded: CandidateGenerationResult['excluded'] = [];

  const solarResult = await generateFromRecord(
    record.rawText,
    existingNodes,
    segments,
    record.id,
    record.context as Record<string, unknown> | undefined,
  );

  let skillHash: string | null = null;
  try {
    skillHash = (await import('../solar.js')).computeSkillHash();
  } catch {
    // ignore
  }

  const createdProposals: Array<{ id: string; type: string; action: string; reason: string }> = [];

  if (solarResult.status === 'success') {
    for (const nodeDraft of solarResult.newNodes) {
      const nodeValidation = validateNewNodeDraft(nodeDraft, recordSegmentIdSet, segments);
      if (!nodeValidation.ok) {
        excluded.push({ source: 'newNode', reason: nodeValidation.reason ?? '' });
        continue;
      }
      if (!nodeDraft.title) {
        continue;
      }

      const newNodeProposal = await db.proposal.create({
        data: {
          userId,
          type: '추가',
          action: `새 위키 노드 생성 제안: ${nodeDraft.title}`,
          reason: nodeDraft.summary
            ? `Solar가 원문 기반으로 새 위키 노드 후보를 제안함. 요약: ${nodeDraft.summary}`
            : 'Solar가 원문 기반으로 새 위키 노드 후보를 제안함.',
          proposalHash: `${record.id}:추가:${nodeDraft.title}:${nodeDraft.summary}`,
          evidenceSegmentIds: segments.map((s) => s.id),
          relatedSegmentIds: segments.map((s) => s.id),
          relatedRecordId: record.id,
          baseNodeVersion: null,
          skillHash,
          hasSensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
          sensitiveInfoWarning: solarResult.sensitiveInfo.warning || undefined,
          sensitiveInfoNodeIds: solarResult.sensitiveInfo.nodeIds || [],
          status: '제안됨',
          targetNodeId: undefined,
          sourceNodeId: undefined,
          // 신규 노드 초안 payload (스키마 반영 필드)
          draftPayload: {
            title: nodeDraft.title,
            summary: nodeDraft.summary,
            content: nodeDraft.content,
            topics: nodeDraft.topics,
            tags: nodeDraft.tags,
            categories: nodeDraft.categories,
          },
        },
      });

      for (const seg of segments) {
        const existing = await db.conversationSegment.findUnique({ where: { id: seg.id } });
        if (existing) {
          await db.proposalEvidence.create({
            data: {
              proposalId: newNodeProposal.id,
              segmentId: seg.id,
              quote: existing.rawText,
              originalStart: existing.rawStart,
              originalEnd: existing.rawEnd,
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

    for (const propDraft of solarResult.proposals) {
      if (!propDraft.action && !propDraft.reason) continue;

      const validation = validateProposalDraft(
        propDraft,
        recordSegmentIdSet,
        existingNodesById,
        userId,
      );
      if (!validation.ok) {
        excluded.push({ source: 'proposal', reason: validation.reason ?? '' });
        continue;
      }

      const targetNodeId = propDraft.targetNodeId || validation.targetNode?.id || undefined;
      const relatedRecordId = record.id;

      const beforePayload = propDraft.before
        ? {
            summary: propDraft.before.summary,
            content: propDraft.before.content,
            topics: propDraft.before.topics,
            tags: propDraft.before.tags,
            categories: propDraft.before.categories,
          }
        : undefined;

      const afterPayload = propDraft.after
        ? {
            summary: propDraft.after.summary,
            content: propDraft.after.content,
            topics: propDraft.after.topics,
            tags: propDraft.after.tags,
            categories: propDraft.after.categories,
          }
        : undefined;

      const proposal = await db.proposal.create({
        data: {
          userId,
          type: propDraft.type,
          action: propDraft.action,
          reason: propDraft.reason,
          proposalHash: `${record.id}:${propDraft.type}:${propDraft.reason}`,
          evidenceSegmentIds: propDraft.evidenceSegments,
          relatedSegmentIds: propDraft.relatedSegmentIds,
          relatedRecordId: relatedRecordId,
          baseNodeVersion: null,
          skillHash,
          hasSensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
          sensitiveInfoWarning: solarResult.sensitiveInfo.warning || undefined,
          sensitiveInfoNodeIds: solarResult.sensitiveInfo.nodeIds || [],
          status: '제안됨',
          targetNodeId: targetNodeId,
          sourceNodeId: propDraft.sourceNodeId || undefined,
          // 변경안 payload / before / after (스키마 반영 필드)
          changePayload: {
            type: propDraft.type,
            targetNodeId: propDraft.targetNodeId,
            sourceNodeId: propDraft.sourceNodeId,
            action: propDraft.action,
            reason: propDraft.reason,
            evidence: propDraft.evidence,
            relatedSegmentIds: propDraft.relatedSegmentIds,
            relatedRecordId: propDraft.relatedRecordId,
            before: beforePayload,
            after: afterPayload,
          },
          before: beforePayload,
          after: afterPayload,
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
  }

  return {
    status: solarResult.status,
    proposals: createdProposals,
    interestCandidatesCount: solarResult.interestCandidates.length,
    sensitiveInfo: solarResult.sensitiveInfo,
    excluded,
    error:
      solarResult.status === 'service_error'
        ? `Solar 서비스 오류: ${solarResult.error?.message || '알 수 없는 오류'}`
        : solarResult.status === 'parse_error'
          ? `Solar 응답 파싱 실패: ${solarResult.error?.message || 'JSON 파싱 오류'}`
          : solarResult.status === 'no_result'
            ? 'Solar 응답이 비어 있음'
            : solarResult.status === 'success' && solarResult.sensitiveInfo.hasSensitiveInfo
              ? solarResult.sensitiveInfo.warning
                ? `민감 정보 감지: ${solarResult.sensitiveInfo.warning}`
                : '민감 정보가 포함된 원문입니다'
              : undefined,
  };
}
