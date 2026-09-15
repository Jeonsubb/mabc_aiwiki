import { db } from '../db';
import {
  searchChatMessages,
  searchWikiNodes,
  parseChatSearchParams,
  parseWikiSearchParams,
} from './queries';
import { parseKeywords } from './queries';

// ── 검색 신호 감지 ─────────────────────────────────────────────────────────────

const WORD_SEP = /[^가-힣a-zA-Z0-9_]+/;
const wordSepSource = WORD_SEP.source;
const wordSepPattern = `(?:^|${wordSepSource})`;
const wordSepPatternEnd = `(?:${wordSepSource}|$)`;

function makeIntentPattern(words: string): RegExp {
  return new RegExp(`${wordSepPattern}(?:${words})${wordSepPatternEnd}`, 'iu');
}

function makeSingleTermPattern(words: string): RegExp {
  return new RegExp(`(?:^|${wordSepSource})(?:${words})(?:$|${wordSepSource})`, 'iu');
}

const PAST_CONVERSATION_PATTERNS = [
  makeIntentPattern(
    '이전|과거|지난|예전|아까|요즘|전에|예전에|앞에서|아까 전에|저번에|지난번|예전 대화|채팅|대화방|메시지|말한|얘기|했던|나왔던',
  ),
  // '대화' 단독은 오탐이 커서, 수식어와 함께 나올 때만 과거 대화로 본다.
  makeSingleTermPattern(
    '아까 전에 대화|전에 대화|예전에 대화|예전 대화|전에 했던|예전에 했던|아까 했던|저번에|지난번|지난 대화|대화방|메시지|말한|얘기|했던|나왔던|앞에서|요즘 대화',
  ),
];

const WIKI_PATTERNS = [
  makeIntentPattern(
    '위키|주제|노드|노드에|정리한|정리된|주제별|위키에|모은|모아둔',
  ),
  // '정리' 단독은 너무 넓다. '정리' + 대상/상태가 같이 나올 때만 위키 신호로 본다.
  makeSingleTermPattern(
    '위키|위키에|노드에|주제별|주제|정리한|정리된|모은|모아둔',
  ),
];

function hasPastConversationHint(text: string): boolean {
  return PAST_CONVERSATION_PATTERNS.some((p) => p.test(text));
}

function hasWikiHint(text: string): boolean {
  return WIKI_PATTERNS.some((p) => p.test(text));
}

// ── 검색 쿼리 후보 추출 ────────────────────────────────────────────────────────

export interface SearchIntent {
  pastConversation: boolean;
  wiki: boolean;
  query: string;
}

export function detectSearchIntent(userMessage: string): SearchIntent {
  const text = userMessage.trim();

  const pastConversation = hasPastConversationHint(text);
  const wiki = hasWikiHint(text);

  let query = text;
  if (pastConversation || wiki) {
    query = stripDirectiveClauses(text);
  }
  if (query.length > 500) {
    query = query.slice(0, 500);
  }

  return { pastConversation, wiki, query };
}

function stripDirectiveClauses(text: string): string {
  // 요청 서두만 정리한다. 본문 검색어는 가능한 한 남긴다.
  return text
    .replace(
      /^(참고로 말해주면|참고로 알려줘|참고로 알려주면|참고로 정리해주면|참고로|정리해?줘)\s*/iu,
      '',
    )
    .trim();
}

// ── 검색 결과 → Solar 프롬프트용 맥락 블록 ─────────────────────────────────────

export interface SearchedWithContext {
  pastMessages: Array<{
    messageId: string;
    chatId: string;
    role: string;
    content: string;
    createdAt: string;
    linkedNode: { nodeId: string; nodeTitle: string } | null;
  }>;
  wikiNodes: Array<{
    nodeId: string;
    title: string;
    summary: string;
    content: string;
    topics: string[];
    tags: string[];
    linkedMessage: {
      messageId: string;
      chatId: string;
      content: string;
      createdAt: string;
    } | null;
  }>;
}

export interface BuildContextOptions {
  chatId?: string;
  userId: string;
}

export async function buildChatWithContext(
  userMessage: string,
  options: BuildContextOptions,
): Promise<{ intent: SearchIntent; context: SearchedWithContext }> {
  const intent = detectSearchIntent(userMessage);

  const pastMessages: SearchedWithContext['pastMessages'] = [];
  const wikiNodes: SearchedWithContext['wikiNodes'] = [];

  if (intent.pastConversation) {
    const filters = parseChatSearchParams({
      q: intent.query,
      chatId: options.chatId,
      limit: '20',
      offset: '0',
    });

    if (filters.invalid.length === 0) {
      const { results } = await searchChatMessages(options.userId, filters, options.chatId);
      // 과거 대화 맥락은 user/assistant 둘 다 넘겨야 Solar가 실제 대화 내용을 참고할 수 있다.
      pastMessages.push(...results.slice(0, 10));
    }
  }

  if (intent.wiki && intent.query.trim().length > 0) {
    const filters = parseWikiSearchParams({
      q: intent.query,
      limit: '20',
      offset: '0',
    });

    if (filters.invalid.length === 0) {
      const { results } = await searchWikiNodes(options.userId, filters);
      wikiNodes.push(...results.slice(0, 10));
    }
  }

  return { intent, context: { pastMessages, wikiNodes } };
}

// ── Solar 프롬프트용 맥락 문자열 ───────────────────────────────────────────────

export function formatContextBlock(ctx: SearchedWithContext): string {
  const parts: string[] = [];

  if (ctx.pastMessages.length > 0) {
    parts.push('## 최근 대화 맥락\n' + ctx.pastMessages.map((m) => {
      const meta = m.linkedNode
        ? ` [위키 노드: ${m.linkedNode.nodeTitle}]`
        : '';
      return `- (${new Date(m.createdAt).toLocaleString()}) ${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}${meta}`;
    }).join('\n'));
  }

  if (ctx.wikiNodes.length > 0) {
    parts.push('## 관련 위키 노드\n' + ctx.wikiNodes.map((n) => {
      const msgMeta = n.linkedMessage
        ? `\n  참고 메시지: "${n.linkedMessage.content}" (${new Date(n.linkedMessage.createdAt).toLocaleString()})`
        : '';
      return `### ${n.title}\n- 요약: ${n.summary}\n- 내용: ${n.content}${msgMeta}`;
    }).join('\n\n'));
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join('\n\n') + '\n\n';
}
