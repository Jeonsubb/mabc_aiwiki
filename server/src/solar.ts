import { formatContextBlock, SearchedWithContext } from './search/chat-context';
import OpenAI from 'openai';
import { createHash } from 'crypto';

const apiKey = process.env.SOLAR_API_KEY || '';
const client: OpenAI | null = apiKey
  ? new OpenAI({
      baseURL: process.env.SOLAR_BASE_URL || 'https://api.upstage.ai/v1',
      apiKey,
    })
  : null;

export const SOLAR_MODEL = process.env.SOLAR_MODEL || 'solar-pro4';

export type SolarRunStatus =
  | 'success'
  | 'no_result'
  | 'parse_error'
  | 'service_error';

export interface SolarError {
  kind: 'no_result' | 'parse_error' | 'service_error' | 'invalid_type';
  message?: string;
}

export interface SolarResult {
  status: SolarRunStatus;
  newNodes: WikiNodeDraft[];
  proposals: ProposalDraft[];
  interestCandidates: Array<{ interest: string; snippet: string }>;
  sensitiveInfo: {
    hasSensitiveInfo: boolean;
    warning?: string;
    nodeIds?: string[];
    types?: string[];
  };
  error?: SolarError;
}

export interface WikiNodeDraft {
  title: string;
  summary: string;
  content: string;
  topics: string[];
  tags: string[];
  categories: string[];
}

export interface ProposalDraft {
  type: '추가' | '갱신' | '분리' | '병합' | '연결' | '보강' | '수정';
  targetNodeId?: string;
  sourceNodeId?: string;
  action: string;
  reason: string;
  evidence: string;
  evidenceSegments: string[];
  before?: { summary: string; content: string; topics?: string[]; tags?: string[]; categories?: string[] };
  after?: { summary: string; content: string; topics?: string[]; tags?: string[]; categories?: string[] };
  relatedSegmentIds: string[];
  relatedRecordId?: string;
}

function loadSkillPrompt(): string {
  try {
    const fs = require('fs');
    const path = require('path');
    // solar.ts는 server/src/ 또는 빌드 후 server/dist/에 있을 수 있다.
    // 둘 다 __dirname 기준으로 ../../docs/가 저장소 루트의 docs/가 되므로
    // 실행 위치와 무관하게 docs/ai-wiki-SKILL.md를 찾는다.
    const skillPath = path.resolve(__dirname, '../../docs/ai-wiki-SKILL.md');
    if (fs.existsSync(skillPath)) return fs.readFileSync(skillPath, 'utf-8');
    console.warn(
      `[solar] ai-wiki-SKILL.md를 찾지 못함: ${skillPath} — 개발/실행 시 규칙 파일이 로드되지 않습니다.`
    );
  } catch (err) {
    console.warn(`[solar] ai-wiki-SKILL.md 로드 중 오류: ${err}`);
  }

  return `당신은 사용자의 AI 대화/메모/아이디어/링크/떠오른 생각을 주제별 위키로 정리하는 정리자다.
운영 규칙:
|- 원본과 정리본을 분리한다.
|- 이미 있는 주제/항목인지 먼저 확인한다.
|- 새 항목이 필요하면 제목, 한 줄 요약, 핵심 내용, 관련 아이디어/링크, 연결 가능한 기존 항목 초안을 만든다.
|- 기존 항목과 비슷하면 유사 의심으로 표시하고 병합/분리/연결 의견을 제안한다. 강제하지 않는다.
|- 태그가 없으면 후보 분류를 붙이고, 애매하면 후보 여러 개/분류 대기로 남긴다.
|- 개인정보/민감 내용은 노출하지 않고 경고만 남긴다.
|- 새로 생긴 관심사/계속 파볼 것을 따로 목록화한다.
|- 덮지 말고 갱신 이력을 우선한다.`;
}

export function computeSkillHash(): string {
  const prompt = loadSkillPrompt();
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export async function generateFromRecord(
  recordRawText: string,
  existingNodes: Array<{ id: string; title: string; summary: string; content: string; topics: string[]; tags: string[]; categories: string[] }>,
  segments: Array<{ id: string; rawText: string; rawStart: number; rawEnd: number }>,
  recordId: string,
  recordContext?: Record<string, unknown>,
): Promise<SolarResult> {
  // API 키가 없으면 mock 응답 반환 (로컬 테스트용)
  if (!client) {
    return {
      status: 'no_result',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'no_result', message: 'Solar API 키가 설정되지 않았습니다. 로컬 테스트용 mock 응답입니다.' },
    };
  }

  const skillPrompt = loadSkillPrompt();
  const existingNodesText = existingNodes.length > 0
    ? existingNodes.map((n) => `## 기존 노드 ${n.id}\n제목: ${n.title}\n한 줄 요약: ${n.summary}\n내용: ${n.content}\n태그: ${n.tags.join(', ')}\n분류: ${n.categories.join(', ')}`).join('\n\n')
    : '기존 위키가 비어 있습니다.';

    const systemPrompt = `<ai-wiki-SKILL.md>
${skillPrompt}
</ai-wiki-SKILL.md>

출력은 반드시 JSON 객체 하나로만 반환한다.

공통 규칙:
- 민감해 보이는 정보(비밀번호, 토큰, API 키, 연락처, 비공개 링크, 사적 내용)가 보이면 본문에 쓰지 말고 민감정보 플래그로만 남긴다.
- 기존 위키 노드가 있으면 반드시 먼저 읽고 새 입력과 비교한다.
- 기존 위키와 같은 주제이거나 기존 내용을 보강할 수 있으면 신규 노드보다 갱신 제안을 우선한다.
- 완전히 독립된 새 주제일 때만 newNodes에 신규 노드를 제안한다.
- 태그와 분류가 없으면 적절한 후보를 붙인다.
- proposals의 type은 '갱신' 또는 '연결'만 사용한다.
- 신규 노드는 proposals가 아니라 newNodes에 넣는다.
- 병합·분리·보강·수정 의견은 필요하면 reason에 설명하되 별도 proposals 항목으로 만들지 않는다.
- proposals.evidenceSegments에는 근거를 제공한 현재 원문 세그먼트 ID를 넣는다.
- proposals.relatedSegmentIds에도 관련된 현재 원문 세그먼트 ID를 넣는다.
- evidenceSegments와 relatedSegmentIds에 기존 노드 ID나 존재하지 않는 ID를 넣지 않는다.
- 근거가 약하거나 추측에 가까우면 제안을 만들지 않는다.

갱신 제안 규칙:
- 제목, 핵심 대상, 주제 또는 목적이 기존 노드와 같으면 type='갱신'을 우선한다.
- targetNodeId에는 아래 기존 위키 목록에 있는 실제 노드 ID를 정확히 사용한다.
- before는 참고용이며 실제 변경 전 데이터는 서버가 DB에서 다시 읽는다.
- after는 새로 추가할 내용만 반환하지 말고 기존 내용과 새 내용을 합친 완성본으로 반환한다.
- after에는 summary, content, topics, tags, categories를 모두 포함한다.
- 새로운 정보가 없고 기존 내용과 실질적으로 같으면 갱신 제안을 만들지 않는다.
- 동일한 대상 노드에 여러 갱신 제안을 중복 생성하지 않는다.
- 같은 주제에 대해 newNodes와 갱신 제안을 동시에 만들지 않는다.

위키 노드 관계 제안 규칙:
- 새 대화가 사용자 소유의 기존 위키 노드 두 개 이상을 구체적으로 연결할 때만 type='연결' 제안을 만든다.
- sourceNodeId와 targetNodeId에는 아래 기존 위키 목록에 실제로 존재하는 서로 다른 노드 ID를 정확히 사용한다.
- sourceNodeId와 targetNodeId가 같으면 안 된다.
- 단순히 일반 단어, 카테고리 또는 태그 하나가 같다는 이유만으로 연결하지 않는다.
- 두 노드 사이에 동일한 대상, 사건, 계획, 결정, 원인·결과, 활용 또는 보강 관계가 있어야 한다.
- action에는 어떤 두 위키를 어떻게 연결할지 짧게 작성한다.
- reason에는 두 노드의 관계와 사용자에게 유용한 이유를 구체적으로 작성한다.
- evidence에는 현재 새 대화에서 관계를 뒷받침하는 실제 내용을 작성한다.
- evidenceSegments에는 관계의 근거가 있는 현재 대화 세그먼트 ID를 넣는다.
- relatedSegmentIds에도 동일한 근거 세그먼트 ID를 넣는다.
- 근거가 약하거나 한쪽 위키와만 관련되면 연결 제안을 만들지 않는다.
- 동일한 sourceNodeId와 targetNodeId 조합을 한 응답에서 중복 생성하지 않는다.

연결 제안 예시:
{
  "type": "연결",
  "sourceNodeId": "기존-위키-ID-1",
  "targetNodeId": "기존-위키-ID-2",
  "action": "부산 여행 계획과 여행 콘텐츠 제작 계획 연결",
  "reason": "부산 여행 일정이 콘텐츠 촬영 소재와 제작 일정으로 활용될 수 있음",
  "evidence": "사용자가 부산 여행 중 방문 장소를 촬영해 콘텐츠로 만들겠다고 언급함",
  "evidenceSegments": ["현재-세그먼트-ID"],
  "relatedSegmentIds": ["현재-세그먼트-ID"]
}`;

  const segmentListText =
    segments.length > 0
      ? segments
          .map(
            (s) =>
              ` 세그먼트 id=${s.id}, 위치=${s.rawStart}-${s.rawEnd}, 텍스트="${s.rawText}"`
          )
          .join('\n')
      : '(세그먼트 정보 없음)';

  const contextText =
    recordContext && Object.keys(recordContext).length > 0
      ? `원본 맥락(context):\n${JSON.stringify(recordContext, null, 2)}`
      : '원본 맥락(context): 없음';

  const userPrompt = `## 원본 기록 정보
recordId: ${recordId}
${contextText}

## 원문 세그먼트 목록 (근거 id/위치 확인용)
${segmentListText}

## 입력 대화/메모
${recordRawText}

## 사용자 소유 기존 위키 노드 (있을 때만)
${existingNodesText}

## 출력
{
  "newNodes": [{"title":"...","summary":"...","content":"...","topics":["..."],"tags":["..."],"categories":["..."]}],
  "proposals": [{"type":"...","targetNodeId":"...","sourceNodeId":"...","action":"...","reason":"...","evidence":"...","evidenceSegments":["..."],"before":{"summary":"...","content":"...","topics":["..."],"tags":["..."],"categories":["..."]},"after":{...},"relatedSegmentIds":["..."],"relatedRecordId":"..."}],
  "interestCandidates": [{"interest":"...","snippet":"..."}],
  "sensitiveInfo": {"hasSensitiveInfo":false,"warning":"...","nodeIds":["..."],"types":["..."]}
}`;

  let response;
  try {
    response = await client.chat.completions.create({
      model: SOLAR_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    });
  } catch (err) {
    return {
      status: 'service_error',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'service_error', message: String((err as Error).message ?? '') },
    };
  }

  const choices = response.choices;
  if (!choices || choices.length === 0) {
    return {
      status: 'no_result',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'no_result', message: 'Solar 응답 선택지가 없음' },
    };
  }

  const choice = choices[0];
  if (!choice || !choice.message) {
    return {
      status: 'no_result',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'no_result', message: 'Solar 응답 내용이 없음' },
    };
  }

  const raw = (choice.message.content ?? '').trim();

  if (!raw) {
    return {
      status: 'no_result',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'no_result', message: 'Solar 응답 내용이 없음' },
    };
  }

  const parsed = parseSolarResult(raw);
  if (parsed.status !== 'success') {
    return parsed;
  }

  // evidenceSegments가 비어 있으면 relatedSegmentIds로 보강 (최소 연결은 되게)
  for (const p of parsed.proposals) {
    if (p.evidenceSegments.length === 0 && p.relatedSegmentIds.length > 0) {
      p.evidenceSegments = [...p.relatedSegmentIds];
    }
    if (p.evidenceSegments.length === 0) {
      p.evidenceSegments = [];
    }
  }

  return parsed;
}

function parseSolarResult(raw: string): SolarResult {
  const json = extractJson(raw);
  if (!json) {
    return {
      status: 'no_result',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'no_result', message: 'JSON을 찾을 수 없음' },
    };
  }

  try {
    const obj = json as Record<string, unknown>;
    return {
      status: 'success',
      newNodes: arrayOf(obj.newNodes).map(parseNode),
      proposals: arrayOf(obj.proposals).map(parseProposal),
      interestCandidates: arrayOf(obj.interestCandidates).map(parseInterest),
      sensitiveInfo: parseSensitiveInfo(obj.sensitiveInfo),
    };
  } catch (err) {
    return {
      status: 'parse_error',
      newNodes: [],
      proposals: [],
      interestCandidates: [],
      sensitiveInfo: { hasSensitiveInfo: false },
      error: { kind: 'parse_error', message: String((err as Error).message ?? '') },
    };
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  // 마크다운 코드펜스 제거
  const cleaned = raw
    .replace(/```[a-zA-Z]*\s*\n?/g, '')
    .replace(/\n?\s*```/g, '');

  // 중괄호로 감싸진 블록 중 첫 번째 유효한 JSON 찾기
  const candidate = cleaned.match(/\{[\s\S]*\}/);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emptyResult(): SolarResult {
  return { status: 'success', newNodes: [], proposals: [], interestCandidates: [], sensitiveInfo: { hasSensitiveInfo: false } };
}

function parseNode(n: unknown): WikiNodeDraft {
  if (!n || typeof n !== 'object') return { title: '', summary: '', content: '', topics: [], tags: [], categories: [] };
  const o = n as Record<string, unknown>;
  return {
    title: String(o.title ?? ''),
    summary: String(o.summary ?? ''),
    content: String(o.content ?? ''),
    topics: arrayOfString(o.topics),
    tags: arrayOfString(o.tags),
    categories: arrayOfString(o.categories),
  };
}

function parseProposal(p: unknown): ProposalDraft {
  if (!p || typeof p !== 'object') return { type: '추가', action: '', reason: '', evidence: '', evidenceSegments: [], relatedSegmentIds: [], relatedRecordId: undefined };
  const o = p as Record<string, unknown>;
  const before = o.before && typeof o.before === 'object' ? parseBeforeAfter(o.before as Record<string, unknown>) : undefined;
  const after = o.after && typeof o.after === 'object' ? parseBeforeAfter(o.after as Record<string, unknown>) : undefined;
  return {
    type: validType(String(o.type ?? '추가')),
    targetNodeId: o.targetNodeId ? String(o.targetNodeId) : undefined,
    sourceNodeId: o.sourceNodeId ? String(o.sourceNodeId) : undefined,
    action: String(o.action ?? ''),
    reason: String(o.reason ?? ''),
    evidence: String(o.evidence ?? ''),
    evidenceSegments: arrayOfString(o.evidenceSegments),
    before,
    after,
    relatedSegmentIds: arrayOfString(o.relatedSegmentIds),
    relatedRecordId: o.relatedRecordId ? String(o.relatedRecordId) : undefined,
  };
}

function parseBeforeAfter(v: Record<string, unknown>) {
  return {
    summary: String(v.summary ?? ''),
    content: String(v.content ?? ''),
    topics: arrayOfString(v.topics),
    tags: arrayOfString(v.tags),
    categories: arrayOfString(v.categories),
  };
}

function parseInterest(i: unknown) {
  if (!i || typeof i !== 'object') return { interest: '', snippet: '' };
  const o = i as Record<string, unknown>;
  return { interest: String(o.interest ?? ''), snippet: String(o.snippet ?? '') };
}

function parseSensitiveInfo(si: unknown) {
  if (!si || typeof si !== 'object') return { hasSensitiveInfo: false };
  const o = si as Record<string, unknown>;
  return {
    hasSensitiveInfo: Boolean(o.hasSensitiveInfo),
    warning: o.warning ? String(o.warning) : undefined,
    nodeIds: arrayOfString(o.nodeIds),
    types: arrayOfString(o.types),
  };
}

const VALID_TYPES = ['추가', '갱신', '분리', '병합', '연결', '보강', '수정'] as const;
type ValidType = (typeof VALID_TYPES)[number];

function validType(v: string): ValidType {
  return (VALID_TYPES as readonly string[]).includes(v) ? (v as ValidType) : '추가';
}

function arrayOfString(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function arrayOf<T>(v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  return v as T[];
}

// ── 챗봇 프롬프트 로딩 (server/src/resources/chatbot-system-prompt.md) ───────

export interface ChatContextBlock {
  pastMessages: Array<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    linkedNode?: { nodeId: string; nodeTitle: string } | null;
  }>;
  wikiNodes: Array<{
    nodeId: string;
    title: string;
    summary: string;
    content: string;
    linkedMessage?: { messageId: string; chatId: string; content: string; createdAt: string } | null;
  }>;
}

function loadChatbotSystemPrompt(): string {
  try {
    const fs = require('fs');
    const path = require('path');
    // __dirname은 빌드 후 server/dist/가 되므로, 원본은 ../src/resources/ 아래에 있다.
    const promptPath = path.resolve(__dirname, '../src/resources/chatbot-system-prompt.md');
    if (fs.existsSync(promptPath)) return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    // ignore
  }

  return `당신은 사용자의 생각을 정리하고 대화를 돕는 AI 비서다.
응답은 자연스럽고 간결하게 하라.
민감 정보(비밀번호, 토큰, API키, 연락처, 비공개 링크, 사적 내용)가 보이면 답변에서 그대로 노출하지 말고, 필요한 경우 주의만 언급하라.`;
}

// ── 채팅 답변용 Solar 호출 (chatbot 내장 챗봇) ──────────────────────────────

export interface ChatMessageRole {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatReplyResult {
  status: 'success' | 'service_error' | 'no_result' | 'parse_error';
  content: string;
  error?: string;
}

export async function generateChatReplyWithContext(
  messages: ChatMessageRole[],
  context: SearchedWithContext,
): Promise<ChatReplyResult> {
  if (!client) {
    return {
      status: 'service_error',
      content: '',
      error: 'Solar API 키가 설정되지 않았습니다.',
    };
  }

  const systemPrompt = loadChatbotSystemPrompt();
  const contextBlock = formatContextBlock(context);

  const payload: ChatMessageRole[] = [
    { role: 'system', content: systemPrompt + (contextBlock ? '\n\n' + contextBlock : '') },
    ...messages,
  ];

  try {
    const response = await client.chat.completions.create({
      model: SOLAR_MODEL,
      messages: payload,
      temperature: 0.7,
      max_tokens: 2048,
    });

    const choices = response.choices;
    if (!choices || choices.length === 0) {
      return {
        status: 'no_result',
        content: '',
        error: 'Solar 응답 선택지가 없음',
      };
    }

    const choice = choices[0];
    if (!choice || !choice.message) {
      return {
        status: 'no_result',
        content: '',
        error: 'Solar 응답 내용이 없음',
      };
    }

    const content = (choice.message.content ?? '');
    if (!content.trim()) {
      return {
        status: 'no_result',
        content: '',
        error: 'Solar 응답이 비어 있음',
      };
    }

    return { status: 'success', content: content.trim() };
  } catch (err) {
    return {
      status: 'service_error',
      content: '',
      error: String((err as Error).message ?? 'Solar 호출 오류'),
    };
  }
}
