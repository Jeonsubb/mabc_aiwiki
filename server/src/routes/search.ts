import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

export const searchRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

// ── 검색 공통: 키워드 파싱 ────────────────────────────────────────────────────

function parseKeywords(q?: string): string[] {
  if (!q) return [];
  return q
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── 채팅 메시지 검색 ──────────────────────────────────────────────────────────
//
// GET /api/search/chat-messages
//
// 쿼리:
//   q      - 키워드 (여러 단어면 content ILIKE OR)
//   from   - 시작일 (ISO, createdAt >= from)
//   to     - 종료일 (ISO, createdAt <= to)
//   chatId - 특정 대화방만 (본인 소유 확인)
//   limit  - 기본 20, 최대 100
//   offset - 기본 0
//
// 접근 제어: requireAuth + where { userId }로 본인 데이터만 조회.
// 메시지 role은 제한하지 않음 (user/assistant 모두 검색 대상).
// 결과에 원문, 실제 createdAt, chatId, messageId, 연결된 위키 노드 id 포함.

searchRouter.get('/chat-messages', requireAuth, async (req: Request, res: Response) => {
  console.log('[search-debug] chat-messages called', {
    q: req.query.q,
    userId: (req as any).userId,
    query: req.query,
  });
  try {
    const userId = getUserId(req);
    const q = req.query.q as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const chatId = req.query.chatId as string | undefined;

    // limit/offset: 제공되지 않으면 기본값(limit=20, offset=0), 제공 시 검증
    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;
    let limit = 20;
    let offset = 0;
    if (rawLimit !== undefined && rawLimit !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return res.status(400).json({ error: 'limit은 1 이상 100 이하 정수여야 함' });
      }
      limit = parsed;
    }
    if (rawOffset !== undefined && rawOffset !== '') {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'offset은 0 이상 정수여야 함' });
      }
      offset = parsed;
    }

    // 검색어 검증: 제공 시 문자열이어야 하며, 비어있지 않고 최대 500자
    if (q !== undefined) {
      if (typeof q !== 'string') {
        return res.status(400).json({ error: 'q는 문자열이어야 함' });
      }
      if (q.trim().length > 0) {
        if (q.length > 500) {
          return res.status(400).json({ error: 'q는 500자 이하여야 함' });
        }
      }
    }

    // 날짜 검증: 제공된 경우 유효한 ISO 날짜여야 함
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (from !== undefined && from !== '') {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: 'from은 유효한 날짜(ISO)여야 함' });
      }
    }
    if (to !== undefined && to !== '') {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'to은 유효한 날짜(ISO)여야 함' });
      }
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: 'from은 to보다 이후일 수 없음' });
    }

    const keywords = parseKeywords(q);

    // chatId 지정 시: 대화방 존재 + 소유권 확인하고 실제 검색 조건으로 적용
    let effectiveChatId: string | undefined;
    if (chatId && typeof chatId === 'string' && chatId.trim().length > 0) {
      const trimmed = chatId.trim();
      const chat = await db.chat.findUnique({
        where: { id: trimmed },
        select: { userId: true },
      });
      if (!chat) {
        return res.status(404).json({ error: '대화방을 찾을 수 없음' });
      }
      if (chat.userId !== userId) {
        return res.status(403).json({ error: '이 대화방에 접근할 수 없음' });
      }
      effectiveChatId = trimmed;
    }

    // 메시지 기본 where: 본인 소유 대화방
    const messageWhere: any = {
      chat: { userId },
    };

    if (effectiveChatId) {
      messageWhere.chatId = effectiveChatId;
    }

    if (fromDate || toDate) {
      messageWhere.createdAt = {} as any;
      if (fromDate) (messageWhere.createdAt as any).gte = fromDate;
      if (toDate) (messageWhere.createdAt as any).lte = toDate;
    }

    // 키워드 OR 구성
    const orConditions = keywords.map((kw) => ({ content: { contains: kw } }));

    const messages = await db.chatMessage.findMany({
      where: keywords.length > 0 ? { AND: [messageWhere, { OR: orConditions }] } : messageWhere,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        chatId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    // 메시지 → 연결된 위키 노드 매핑
    const linkedNodes = await buildMessageToNodeMap(messages);

    const nodeMap = new Map(linkedNodes.map((n) => [n.messageId, n]));
    const results = messages.map((m) => {
      const linked = nodeMap.get(m.id);
      return {
        type: 'chat_message',
        messageId: m.id,
        chatId: m.chatId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        linkedNode: linked
          ? { nodeId: linked.nodeId, nodeTitle: linked.nodeTitle }
          : null,
      };
    });

    // 전체 카운트
    const total = keywords.length > 0
      ? await db.chatMessage.count({ where: { AND: [messageWhere, { OR: orConditions }] } })
      : await db.chatMessage.count({ where: messageWhere });

    return res.json({
      results,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('search chat-messages error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 메시지 → 노드 매핑 유틸 ─────────────────────────────────────────────────────
//
// ChatMessage (id, chatId) 목록을 받아, ConversationSegment → Record → RecordToNode
// 경로를 타고 (messageId, nodeId, nodeTitle) 목록을 반환.

async function buildMessageToNodeMap(
  messages: Array<{ id: string; chatId: string }>,
): Promise<Array<{ messageId: string; nodeId: string; nodeTitle: string }>> {
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const chatIds = messages.map((m) => m.chatId);

  const segments = await db.conversationSegment.findMany({
    where: {
      messageId: { in: messageIds },
      chatId: { in: chatIds },
    },
    select: {
      messageId: true,
      recordId: true,
    },
  });

  const recordIds = segments.map((s) => s.recordId);
  let nodeMappings: Array<{
    recordId: string;
    nodeId: string;
    nodeTitle: string;
  }> = [];

  if (recordIds.length > 0) {
    const mappings = await db.recordToNode.findMany({
      where: { recordId: { in: recordIds } },
      include: {
        node: { select: { id: true, title: true } },
      },
    });
    nodeMappings = mappings.map((m) => ({
      recordId: m.recordId,
      nodeId: m.node.id,
      nodeTitle: m.node.title,
    }));
  }

  const recordToNodeMap = new Map(nodeMappings.map((n) => [n.recordId, n]));

  return segments
    .map((s): { messageId: string; nodeId: string; nodeTitle: string } | undefined => {
      const mapping = recordToNodeMap.get(s.recordId);
      if (!mapping || !s.messageId) return undefined;
      return {
        messageId: s.messageId,
        nodeId: mapping.nodeId,
        nodeTitle: mapping.nodeTitle,
      };
    })
    .filter((x): x is { messageId: string; nodeId: string; nodeTitle: string } => x !== undefined);
}

// ── 위키 노드 검색 ────────────────────────────────────────────────────────────
//
// GET /api/search/wiki-nodes
//
// 쿼리:
//   q      - 키워드 (제목/요약/내용/토픽/태그/카테고리 ILIKE OR 또는 hasSome)
//   from   - 시작일 (ISO, createdAt >= from)
//   to     - 종료일 (ISO, createdAt <= to)
//   status - 상태 필터 (예: '활성')
//   limit  - 기본 20, 최대 100
//   offset - 기본 0
//
// 접근 제어: requireAuth + where { userId }.
// 결과에 노드 정보 + 선택적으로 연결된 대표 메시지 원문·시각 포함.
//
// 대표 메시지 선택:
//   노드 ─▶ RecordToNode ─▶ Record ─▶ ConversationSegment
//   세그먼트(messageId 존재)를 createdAt desc로 정렬한 뒤, 각 노드의 첫 번째
//   messageId 보유 세그먼트를 대표로 사용. 없으면 linkedMessage: null.

searchRouter.get('/wiki-nodes', requireAuth, async (req: Request, res: Response) => {
  console.log('[search-debug] wiki-nodes called', {
    q: req.query.q,
    userId: (req as any).userId,
    query: req.query,
  });
  try {
    const userId = getUserId(req);
    const q = req.query.q as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const status = req.query.status as string | undefined;

    // limit/offset: 제공되지 않으면 기본값(limit=20, offset=0), 제공 시 검증
    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;
    let limit = 20;
    let offset = 0;
    if (rawLimit !== undefined && rawLimit !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return res.status(400).json({ error: 'limit은 1 이상 100 이하 정수여야 함' });
      }
      limit = parsed;
    }
    if (rawOffset !== undefined && rawOffset !== '') {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'offset은 0 이상 정수여야 함' });
      }
      offset = parsed;
    }

    // 검색어 검증: 제공 시 문자열이어야 하며, 비어있지 않고 최대 500자
    if (q !== undefined) {
      if (typeof q !== 'string') {
        return res.status(400).json({ error: 'q는 문자열이어야 함' });
      }
      if (q.trim().length > 0) {
        if (q.length > 500) {
          return res.status(400).json({ error: 'q는 500자 이하여야 함' });
        }
      }
    }

    // 날짜 검증
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (from !== undefined && from !== '') {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: 'from은 유효한 날짜(ISO)여야 함' });
      }
    }
    if (to !== undefined && to !== '') {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'to은 유효한 날짜(ISO)여야 함' });
      }
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: 'from은 to보다 이후일 수 없음' });
    }

    const keywords = parseKeywords(q);

    // 노드 기본 where
    const nodeWhere: any = { userId };
    if (status) {
      nodeWhere.status = status;
    }
    if (fromDate || toDate) {
      nodeWhere.createdAt = {} as any;
      if (fromDate) (nodeWhere.createdAt as any).gte = fromDate;
      if (toDate) (nodeWhere.createdAt as any).lte = toDate;
    }

    // 키워드 OR 구성 (문자열 필드 + 배열 필드)
    const orConditions = keywords.flatMap((kw) => [
      { title: { contains: kw } },
      { summary: { contains: kw } },
      { content: { contains: kw } },
      { topics: { hasSome: [kw] } },
      { tags: { hasSome: [kw] } },
      { categories: { hasSome: [kw] } },
    ]);

    const nodes = await db.wikiNode.findMany({
      where: keywords.length > 0 ? { AND: [nodeWhere, { OR: orConditions }] } : nodeWhere,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        summary: true,
        content: true,
        topics: true,
        tags: true,
        categories: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 노드별 대표 메시지 조회
    const linkedMessages = await buildNodeToMessageMap(nodes);

    const msgMap = new Map(linkedMessages.map((m) => [m.nodeId, m]));
    const results = nodes.map((n) => {
      const linked = msgMap.get(n.id);
      return {
        type: 'wiki_node',
        nodeId: n.id,
        title: n.title,
        summary: n.summary,
        content: n.content,
        topics: n.topics,
        tags: n.tags,
        categories: n.categories,
        status: n.status,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        linkedMessage: linked
          ? {
              messageId: linked.messageId,
              chatId: linked.chatId,
              content: linked.content,
              createdAt: linked.createdAt.toISOString(),
            }
          : null,
      };
    });

    // 전체 카운트
    const total = keywords.length > 0
      ? await db.wikiNode.count({ where: { AND: [nodeWhere, { OR: orConditions }] } })
      : await db.wikiNode.count({ where: nodeWhere });

    return res.json({
      results,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('search wiki-nodes error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 노드 → 대표 메시지 매핑 유틸 ─────────────────────────────────────────────────
//
// WikiNode id 목록을 받아, 각 노드에 연결된 RecordToNode → Record →
// ConversationSegment 경로를 타고, 노드별로 가장 최근 createdAt을 가진
// messageId 보유 세그먼트를 대표로 뽑는다. 대표 메시지 내용은 별도 조회.

async function buildNodeToMessageMap(
  nodes: Array<{ id: string }>,
): Promise<Array<{
  nodeId: string;
  messageId: string;
  chatId: string;
  content: string;
  createdAt: Date;
}>> {
  if (nodes.length === 0) return [];

  const nodeIds = nodes.map((n) => n.id);

  const recordMappings = await db.recordToNode.findMany({
    where: { nodeId: { in: nodeIds } },
    select: { nodeId: true, recordId: true },
  });

  const recordIds = recordMappings.map((m) => m.recordId);
  const rawSegments: Array<{
    recordId: string;
    messageId: string | null;
    chatId: string | null;
    createdAt: Date;
  }> = [];

  if (recordIds.length > 0) {
    const found = await db.conversationSegment.findMany({
      where: {
        recordId: { in: recordIds },
        messageId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        recordId: true,
        messageId: true,
        chatId: true,
        createdAt: true,
      },
    });
    rawSegments.push(...found);
  }

  // recordId → segments 목록 (createdAt desc 정렬 유지)
  const segmentsByRecord = new Map<
    string,
    Array<{ recordId: string; messageId: string | null; chatId: string | null; createdAt: Date }>
  >();
  for (const s of rawSegments) {
    const arr = segmentsByRecord.get(s.recordId) || [];
    arr.push(s);
    segmentsByRecord.set(s.recordId, arr);
  }

  // 노드별 대표 메시지 1개 (가장 최근 segment의 messageId)
  const seenNode = new Set<string>();
  const result: Array<{
    nodeId: string;
    messageId: string;
    chatId: string;
    content: string;
    createdAt: Date;
  }> = [];

  for (const m of recordMappings) {
    if (seenNode.has(m.nodeId)) continue;
    const segs = segmentsByRecord.get(m.recordId);
    if (!segs || segs.length === 0) continue;
    const rep = segs[0];
    if (!rep.messageId) continue;

    const msg = await db.chatMessage.findUnique({
      where: { id: rep.messageId },
      select: { content: true, createdAt: true },
    });
    if (!msg) continue;

    seenNode.add(m.nodeId);
    result.push({
      nodeId: m.nodeId,
      messageId: rep.messageId,
      chatId: rep.chatId || '',
      content: msg.content,
      createdAt: msg.createdAt,
    });
  }

  return result;
}
