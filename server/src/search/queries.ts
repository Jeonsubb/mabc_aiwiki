import { db } from '../db';

// ── 키워드 파싱 ────────────────────────────────────────────────────────────────

export function parseKeywords(q?: string): string[] {
  if (!q) return [];
  return q
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── 채팅 메시지 검색 파라미터 파싱/검증 ─────────────────────────────────────────

export interface ChatSearchParams {
  q?: string;
  from?: string;
  to?: string;
  chatId?: string;
  limit?: string;
  offset?: string;
}

export interface ParsedChatSearchParams {
  keywords: string[];
  fromDate?: Date;
  toDate?: Date;
  effectiveChatId?: string;
  limit: number;
  offset: number;
  invalid: Array<{ field: string; message: string }>;
}

export function parseChatSearchParams(
  params: ChatSearchParams,
): ParsedChatSearchParams {
  const invalid: Array<{ field: string; message: string }> = [];

  const q = params.q;
  if (q !== undefined) {
    if (typeof q !== 'string') {
      invalid.push({ field: 'q', message: 'q는 문자열이어야 함' });
    } else {
      if (q.trim().length > 0 && q.length > 500) {
        invalid.push({ field: 'q', message: 'q는 500자 이하여야 함' });
      }
    }
  }

  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from !== undefined && params.from !== '') {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) {
      invalid.push({ field: 'from', message: 'from은 유효한 날짜(ISO)여야 함' });
    }
  }
  if (params.to !== undefined && params.to !== '') {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) {
      invalid.push({ field: 'to', message: 'to은 유효한 날짜(ISO)여야 함' });
    }
  }
  if (fromDate && toDate && fromDate > toDate) {
    invalid.push({ field: 'from', message: 'from은 to보다 이후일 수 없음' });
  }

  let limit = 20;
  if (params.limit !== undefined && params.limit !== '') {
    const parsed = Number(params.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      invalid.push({ field: 'limit', message: 'limit은 1 이상 100 이하 정수여야 함' });
    } else {
      limit = parsed;
    }
  }

  let offset = 0;
  if (params.offset !== undefined && params.offset !== '') {
    const parsed = Number(params.offset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      invalid.push({ field: 'offset', message: 'offset은 0 이상 정수여야 함' });
    } else {
      offset = parsed;
    }
  }

  return {
    keywords: typeof q === 'string' ? parseKeywords(q) : [],
    fromDate,
    toDate,
    effectiveChatId: undefined,
    limit,
    offset,
    invalid,
  };
}

// ── 채팅방 소유권 확인 (검색 조건 적용 전) ─────────────────────────────────────

export type ChatOwnCheck =
  | {
      ok: true;
      chatId: string;
    }
  | {
      ok: false;
      status: 404 | 403;
      error: string;
    };

export async function checkChatOwner(
  chatId: string,
  userId: string,
): Promise<ChatOwnCheck> {
  const chat = await db.chat.findUnique({
    where: { id: chatId },
    select: { userId: true },
  });
  if (!chat) {
    return { ok: false, status: 404, error: '대화방을 찾을 수 없음' };
  }
  if (chat.userId !== userId) {
    return { ok: false, status: 403, error: '이 대화방에 접근할 수 없음' };
  }
  return { ok: true, chatId };
}

// ── 메시지 → 노드 매핑 ─────────────────────────────────────────────────────────

export async function buildMessageToNodeMap(
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
    .map(
      (s): { messageId: string; nodeId: string; nodeTitle: string } | undefined => {
        const mapping = recordToNodeMap.get(s.recordId);
        if (!mapping || !s.messageId) return undefined;
        return {
          messageId: s.messageId,
          nodeId: mapping.nodeId,
          nodeTitle: mapping.nodeTitle,
        };
      },
    )
    .filter(
      (x): x is { messageId: string; nodeId: string; nodeTitle: string } =>
        x !== undefined,
    );
}

// ── 채팅 메시지 검색 실행 ──────────────────────────────────────────────────────

export interface ChatSearchResult {
  type: 'chat_message';
  messageId: string;
  chatId: string;
  role: string;
  content: string;
  createdAt: string;
  linkedNode: { nodeId: string; nodeTitle: string } | null;
}

export async function searchChatMessages(
  userId: string,
  filters: ReturnType<typeof parseChatSearchParams>,
  effectiveChatId?: string,
): Promise<{ results: ChatSearchResult[]; total: number }> {
  const messageWhere: any = {
    chat: { userId },
  };

  if (effectiveChatId) {
    messageWhere.chatId = effectiveChatId;
  }

  if (filters.fromDate || filters.toDate) {
    messageWhere.createdAt = {} as any;
    if (filters.fromDate) (messageWhere.createdAt as any).gte = filters.fromDate;
    if (filters.toDate) (messageWhere.createdAt as any).lte = filters.toDate;
  }

  const orConditions = filters.keywords.map((kw) => ({ content: { contains: kw } }));

  const messages = await db.chatMessage.findMany({
    where:
      filters.keywords.length > 0
        ? { AND: [messageWhere, { OR: orConditions }] }
        : messageWhere,
    orderBy: { createdAt: 'desc' },
    take: filters.limit,
    skip: filters.offset,
    select: {
      id: true,
      chatId: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });

  const linkedNodes = await buildMessageToNodeMap(messages);

  const nodeMap = new Map(linkedNodes.map((n) => [n.messageId, n]));
  const results: ChatSearchResult[] = messages.map((m) => {
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

  const total =
    filters.keywords.length > 0
      ? await db.chatMessage.count({
          where: { AND: [messageWhere, { OR: orConditions }] },
        })
      : await db.chatMessage.count({ where: messageWhere });

  return { results, total };
}

// ── 위키 노드 검색 파라미터 파싱/검증 ──────────────────────────────────────────

export interface WikiSearchParams {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

export interface ParsedWikiSearchParams {
  keywords: string[];
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  limit: number;
  offset: number;
  invalid: Array<{ field: string; message: string }>;
}

export function parseWikiSearchParams(
  params: WikiSearchParams,
): ParsedWikiSearchParams {
  const invalid: Array<{ field: string; message: string }> = [];

  const q = params.q;
  if (q !== undefined) {
    if (typeof q !== 'string') {
      invalid.push({ field: 'q', message: 'q는 문자열이어야 함' });
    } else {
      if (q.trim().length > 0 && q.length > 500) {
        invalid.push({ field: 'q', message: 'q는 500자 이하여야 함' });
      }
    }
  }

  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (params.from !== undefined && params.from !== '') {
    fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) {
      invalid.push({ field: 'from', message: 'from은 유효한 날짜(ISO)여야 함' });
    }
  }
  if (params.to !== undefined && params.to !== '') {
    toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) {
      invalid.push({ field: 'to', message: 'to은 유효한 날짜(ISO)여야 함' });
    }
  }
  if (fromDate && toDate && fromDate > toDate) {
    invalid.push({ field: 'from', message: 'from은 to보다 이후일 수 없음' });
  }

  let limit = 20;
  if (params.limit !== undefined && params.limit !== '') {
    const parsed = Number(params.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      invalid.push({ field: 'limit', message: 'limit은 1 이상 100 이하 정수여야 함' });
    } else {
      limit = parsed;
    }
  }

  let offset = 0;
  if (params.offset !== undefined && params.offset !== '') {
    const parsed = Number(params.offset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      invalid.push({ field: 'offset', message: 'offset은 0 이상 정수여야 함' });
    } else {
      offset = parsed;
    }
  }

  return {
    keywords: typeof q === 'string' ? parseKeywords(q) : [],
    fromDate,
    toDate,
    status: params.status,
    limit,
    offset,
    invalid,
  };
}

// ── 노드 → 대표 메시지 매핑 ────────────────────────────────────────────────────

export async function buildNodeToMessageMap(
  nodes: Array<{ id: string }>,
): Promise<
  Array<{
    nodeId: string;
    messageId: string;
    chatId: string;
    content: string;
    createdAt: Date;
  }>
> {
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

  const segmentsByRecord = new Map<
    string,
    Array<{
      recordId: string;
      messageId: string | null;
      chatId: string | null;
      createdAt: Date;
    }>
  >();
  for (const s of rawSegments) {
    const arr = segmentsByRecord.get(s.recordId) || [];
    arr.push(s);
    segmentsByRecord.set(s.recordId, arr);
  }

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

// ── 위키 노드 검색 실행 ────────────────────────────────────────────────────────

export interface WikiSearchResult {
  type: 'wiki_node';
  nodeId: string;
  title: string;
  summary: string;
  content: string;
  topics: string[];
  tags: string[];
  categories: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  linkedMessage: {
    messageId: string;
    chatId: string;
    content: string;
    createdAt: string;
  } | null;
}

export async function searchWikiNodes(
  userId: string,
  filters: ReturnType<typeof parseWikiSearchParams>,
): Promise<{ results: WikiSearchResult[]; total: number }> {
  const nodeWhere: any = { userId };
  if (filters.status) {
    nodeWhere.status = filters.status;
  }
  if (filters.fromDate || filters.toDate) {
    nodeWhere.createdAt = {} as any;
    if (filters.fromDate) (nodeWhere.createdAt as any).gte = filters.fromDate;
    if (filters.toDate) (nodeWhere.createdAt as any).lte = filters.toDate;
  }

  const orConditions = filters.keywords.flatMap((kw) => [
    { title: { contains: kw } },
    { summary: { contains: kw } },
    { content: { contains: kw } },
    { topics: { hasSome: [kw] } },
    { tags: { hasSome: [kw] } },
    { categories: { hasSome: [kw] } },
  ]);

  const nodes = await db.wikiNode.findMany({
    where:
      filters.keywords.length > 0
        ? { AND: [nodeWhere, { OR: orConditions }] }
        : nodeWhere,
    orderBy: { updatedAt: 'desc' },
    take: filters.limit,
    skip: filters.offset,
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

  const linkedMessages = await buildNodeToMessageMap(nodes);

  const msgMap = new Map(linkedMessages.map((m) => [m.nodeId, m]));
  const results: WikiSearchResult[] = nodes.map((n) => {
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

  const total =
    filters.keywords.length > 0
      ? await db.wikiNode.count({ where: { AND: [nodeWhere, { OR: orConditions }] } })
      : await db.wikiNode.count({ where: nodeWhere });

  return { results, total };
}
