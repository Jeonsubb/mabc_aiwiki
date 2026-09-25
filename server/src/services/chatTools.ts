import { db, hashContent } from '../db';
import { generateCandidatesForRecord } from './candidateGenerator';
import { searchWikiNodes, searchChatMessages, parseWikiSearchParams, parseChatSearchParams } from '../search/queries';

// ── 도구 정의 ──────────────────────────────────────────────────────────────────

export const chatTools = [
  {
    name: 'search_wiki',
    description: '사용자의 위키 노드를 검색한다. 제목/요약/id/목록을 반환한다.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_chats',
    description: '사용자의 과거 대화 메시지를 검색한다. 역할/내용/날짜/id/목록을 반환한다.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어' },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_to_wiki',
    description: '현재 대화 내용을 위키 후보로 저장한다. text가 주어지면 그 텍스트를, 없으면 현재 대화방 메시지 전체를 role:content 줄로 이어 붙인 텍스트를 원문으로 Record(source=chat)를 만들고 위키 후보 생성을 요청한다. 생성된 제안의 id/type/action 목록을 반환한다.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '저장할 텍스트. 생략하면 현재 대화방 메시지를 사용한다.' },
      },
      required: [],
    },
  },
] as const;

// ── 검색 결과 축소 포장 ─────────────────────────────────────────────────────────

interface WikiSearchItem {
  id: string;
  title: string;
  summary: string;
  topics: string[];
}

interface ChatSearchItem {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

async function searchWikiItems(userId: string, query: string): Promise<{ total: number; items: WikiSearchItem[] }> {
  const filters = parseWikiSearchParams({ q: query, limit: '20', offset: '0' });
  if (filters.invalid.length > 0) {
    return { total: 0, items: [] };
  }
  const { results, total } = await searchWikiNodes(userId, filters);
  return {
    total,
    items: results.map((r) => ({
      id: r.nodeId,
      title: r.title,
      summary: r.summary,
      topics: r.topics,
    })),
  };
}

async function searchChatItems(userId: string, query: string, chatId?: string): Promise<{ total: number; items: ChatSearchItem[] }> {
  const filters = parseChatSearchParams({ q: query, limit: '20', offset: '0' });
  if (filters.invalid.length > 0) {
    return { total: 0, items: [] };
  }
  const effectiveChatId = chatId ?? undefined;
  const { results, total } = await searchChatMessages(userId, filters, effectiveChatId);
  return {
    total,
    items: results.map((r) => ({
      id: r.messageId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    })),
  };
}

// ── 저장 도구 ───────────────────────────────────────────────────────────────────

async function saveToWiki(userId: string, chatId: string, text?: string): Promise<{ proposals: Array<{ id: string; type: string; action: string }> }> {
  let rawText: string;

  if (text && text.trim().length > 0) {
    rawText = text.trim();
  } else {
    const messages = await db.chatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    rawText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    if (rawText.length === 0) {
      return { proposals: [] };
    }
  }

  const contentHash = await hashContent(rawText);
  const record = await db.record.create({
    data: {
      userId,
      conversationId: `chat_${chatId}_${Date.now()}`,
      source: 'chat',
      rawText,
      contentHash,
      status: '처리중',
    },
  });

  const candidateResult = await generateCandidatesForRecord(userId, record.id);

  const proposals = candidateResult.proposals.map((p) => ({
    id: p.id,
    type: p.type,
    action: p.action,
  }));

  return { proposals };
}

// ── 도구 실행 ───────────────────────────────────────────────────────────────────

export async function executeChatTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  chatId?: string,
): Promise<unknown> {
  if (toolName === 'search_wiki') {
    const query = (params.query as string) || '';
    return searchWikiItems(userId, query);
  }

  if (toolName === 'search_chats') {
    const query = (params.query as string) || '';
    return searchChatItems(userId, query, chatId);
  }

  if (toolName === 'save_to_wiki') {
    const text = typeof params.text === 'string' ? params.text : undefined;
    return saveToWiki(userId, chatId!, text);
  }

  throw new Error(`알 수 없는 도구: ${toolName}`);
}
