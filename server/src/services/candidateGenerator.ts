import { Prisma } from '@prisma/client';
import { db } from '../db';
import {
  generateFromRecord,
  normalizeTags,
  type SolarResult,
} from '../solar';

export interface CandidateGenerationResult {
  status: SolarResult['status'];
  proposals: Array<{ id: string; type: string; action: string; reason: string }>;
  interestCandidatesCount: number;
  sensitiveInfo: SolarResult['sensitiveInfo'];
  error?: string;
  excluded: Array<{ source: 'newNode' | 'proposal'; reason: string }>;
}

const VALID_PROPOSAL_TYPES = ['갱신'] as const;

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
  if (type === '연결') {
  const sourceNodeId = propDraft.sourceNodeId;
  const targetNodeId = propDraft.targetNodeId;

  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
    return { ok: false, reason: '연결할 두 노드가 유효하지 않음', targetNode };
  }

  const sourceNode = existingNodesById.get(sourceNodeId);
  if (!sourceNode || sourceNode.userId !== userId) {
    return { ok: false, reason: '연결 출발 노드가 사용자 노드가 아님', targetNode };
  }
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

  const existingRelationships = await db.nodeRelationship.findMany({
    where: { userId },
    select: { tags: true },
  });

  const existingTags = normalizeTags([
    ...existingNodes.flatMap((node) => node.tags),
    ...existingRelationships.flatMap((relationship) => relationship.tags),
  ]);
  const recordSegmentIdSet = new Set(segments.map((s) => s.id));
  const existingNodesById = new Map(existingNodes.map((n) => [n.id, { id: n.id, userId: n.userId }]));
  const excluded: CandidateGenerationResult['excluded'] = [];

  const solarResult = await generateFromRecord(
    record.rawText,
    existingNodes,
    segments,
    record.id,
    record.context as Record<string, unknown> | undefined,
    existingTags,
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

            const connectionTargetNodeId =
        nodeDraft.connectionTargetNodeId?.trim() ?? '';

      const connectionReason =
        nodeDraft.connectionReason?.trim() ?? '';

      const connectionRelationType =
        nodeDraft.connectionRelationType?.trim() ?? '';

      const connectionSchemaReason =
        nodeDraft.connectionSchemaReason?.trim() || connectionReason;

      const connectionTags = normalizeTags(
        nodeDraft.connectionTags,
        existingTags,
      );

      const connectionTarget = connectionTargetNodeId
        ? existingNodesById.get(connectionTargetNodeId)
        : undefined;

      const hasConnection = Boolean(
        connectionTarget &&
        connectionTarget.userId === userId &&
        connectionReason &&
        connectionRelationType &&
        connectionRelationType.length <= 40 &&
        connectionTags.length > 0
      );

      if (connectionTargetNodeId && !hasConnection) {
        excluded.push({
          source: 'newNode',
          reason:
            '연결 대상·이유·관계 유형·태그가 유효하지 않아 연결을 제외하고 신규 노드만 제안함',
        });
      }

      const connectionPayload = hasConnection
        ? {
            connectionTargetNodeId,
            connectionReason,
            connectionRelationType,
            connectionSchemaReason,
            connectionTags,
          }
        : {
            connectionTargetNodeId: null,
            connectionReason: null,
            connectionRelationType: null,
            connectionSchemaReason: null,
            connectionTags: [],
          };

      const finalNodeTags = normalizeTags(
        [
          ...nodeDraft.tags,
          ...(hasConnection ? connectionTags : []),
        ],
        existingTags,
      );

      const newNodeProposal = await db.proposal.create({
        data: {
          userId,
          type: '추가',
          action: `새 위키 노드 생성 제안: ${nodeDraft.title}`,
          reason: nodeDraft.summary
            ? `Solar가 원문 기반으로 새 위키 노드 후보를 제안함. 요약: ${nodeDraft.summary}`
            : 'Solar가 원문 기반으로 새 위키 노드 후보를 제안함.',
          proposalHash:
            `${record.id}:추가:${nodeDraft.title}:${nodeDraft.summary}`,
          evidenceSegmentIds: segments.map((s) => s.id),
          relatedSegmentIds: segments.map((s) => s.id),
          relatedRecordId: record.id,
          baseNodeVersion: null,
          skillHash,
          hasSensitiveInfo:
            solarResult.sensitiveInfo.hasSensitiveInfo,
          sensitiveInfoWarning:
            solarResult.sensitiveInfo.warning || undefined,
          sensitiveInfoNodeIds:
            solarResult.sensitiveInfo.nodeIds || [],
          status: '제안됨',
          draftPayload: {
            title: nodeDraft.title,
            summary: nodeDraft.summary,
            content: nodeDraft.content,
            topics: nodeDraft.topics,
            tags: finalNodeTags,
            categories: nodeDraft.categories,
            ...connectionPayload,
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
      if (propDraft.type === '추가') {
        excluded.push({ source: 'proposal', reason: '신규 노드는 newNodes 경로에서만 제안함' });
        continue;
      }

      if (!propDraft.action && !propDraft.reason) continue;

            if (propDraft.type === '연결') {
        propDraft.tags = normalizeTags(propDraft.tags, existingTags);

        if (propDraft.tags.length === 0) {
          excluded.push({
            source: 'proposal',
            reason: '연결 태그가 없어 연결 제안을 제외함',
          });
          continue;
        }

        if (!propDraft.evidence.trim()) {
          excluded.push({
            source: 'proposal',
            reason: '연결 근거가 없어 연결 제안을 제외함',
          });
          continue;
        }
      }

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
      if (propDraft.type === '연결') {
  const sourceNodeId = propDraft.sourceNodeId;
  const connectionTargetNodeId = propDraft.targetNodeId;

  if (!sourceNodeId || !connectionTargetNodeId) {
    excluded.push({
      source: 'proposal',
      reason: '연결 제안에 sourceNodeId 또는 targetNodeId가 없음',
    });
    continue;
  }

  const [existingRelationship, pendingConnectionProposal] =
    await Promise.all([
      db.nodeRelationship.findFirst({
        where: {
          userId,
          OR: [
            {
              sourceNodeId,
              targetNodeId: connectionTargetNodeId,
            },
            {
              sourceNodeId: connectionTargetNodeId,
              targetNodeId: sourceNodeId,
            },
          ],
        },
      }),
      db.proposal.findFirst({
        where: {
          userId,
          type: '연결',
          status: '제안됨',
          OR: [
            {
              sourceNodeId,
              targetNodeId: connectionTargetNodeId,
            },
            {
              sourceNodeId: connectionTargetNodeId,
              targetNodeId: sourceNodeId,
            },
          ],
        },
      }),
    ]);

  if (existingRelationship) {
    excluded.push({
      source: 'proposal',
      reason: `이미 연결된 노드 관계임: ${sourceNodeId} ↔ ${connectionTargetNodeId}`,
    });
    continue;
  }

  if (pendingConnectionProposal) {
    excluded.push({
      source: 'proposal',
      reason: `이미 대기 중인 연결 제안이 있음: ${sourceNodeId} ↔ ${connectionTargetNodeId}`,
    });
    continue;
  }
}
      const targetNodeId = propDraft.targetNodeId || validation.targetNode?.id || undefined;
      const relatedRecordId = record.id;

      // 변경 전 스냅샷은 Solar 답변이 아니라 실제 DB 노드의 현재 내용으로 저장한다.
      let baseNodeVersion: number | null = null;
      let beforePayload: Record<string, unknown> | undefined;

      if (targetNodeId) {
        const targetNode = await db.wikiNode.findUnique({
          where: { id: targetNodeId },
          select: {
            summary: true,
            content: true,
            topics: true,
            tags: true,
            categories: true,
            latestVersion: true,
          },
        });
        if (targetNode) {
          baseNodeVersion = targetNode.latestVersion;
          beforePayload = {
            summary: targetNode.summary,
            content: targetNode.content,
            topics: targetNode.topics,
            tags: targetNode.tags,
            categories: targetNode.categories,
          };
        }
      }

      // Prisma JSON 필드 입력 형태에 맞춰 직렬화 가능한 객체로만 전달한다.
     if (propDraft.type === '갱신' && (!targetNodeId || !beforePayload || !propDraft.after)) {
  excluded.push({ source: 'proposal', reason: '갱신에 대상 노드 또는 변경 후 내용이 없음' });
  continue;
}

const afterPayload = propDraft.after;

const changePayload = JSON.parse(JSON.stringify({
  type: propDraft.type,
  targetNodeId,
  sourceNodeId: propDraft.sourceNodeId,
  action: propDraft.action,
  reason: propDraft.reason,
  evidence: propDraft.evidence,
  tags: propDraft.type === '연결' ? propDraft.tags : undefined,
  relatedSegmentIds: propDraft.relatedSegmentIds,
  relatedRecordId: propDraft.relatedRecordId,
  before: beforePayload,
  after: afterPayload,
  sourceConceptType: propDraft.sourceConceptType,
  targetConceptType: propDraft.targetConceptType,
  relationType: propDraft.relationType,
  schemaReason: propDraft.schemaReason,
})) as Prisma.InputJsonValue;

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
          baseNodeVersion: baseNodeVersion,
          skillHash,
          hasSensitiveInfo: solarResult.sensitiveInfo.hasSensitiveInfo,
          sensitiveInfoWarning: solarResult.sensitiveInfo.warning || undefined,
          sensitiveInfoNodeIds: solarResult.sensitiveInfo.nodeIds || [],
          status: '제안됨',
          targetNodeId: targetNodeId,
          sourceNodeId: propDraft.sourceNodeId || undefined,
          // 변경안 payload / before / after (스키마 반영 필드)
          changePayload,
...(beforePayload
  ? { before: beforePayload as Prisma.InputJsonValue }
  : {}),
...(afterPayload
  ? { after: afterPayload as Prisma.InputJsonValue }
  : {}),
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
