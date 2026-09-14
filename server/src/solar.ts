import OpenAI from 'openai';
import { createHash } from 'crypto';

const apiKey = process.env.SOLAR_API_KEY || '';
const client = apiKey
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
    const skillPath = path.resolve(__dirname, '../../ai-wiki-SKILL.md');
    if (fs.existsSync(skillPath)) return fs.readFileSync(skillPath, 'utf-8');
  } catch {
    // ignore
  }

  return `당신은 사용자의 AI 대화/메모/아이디어/링크/떠오른 생각을 주제별 위키로 정리하는 정리자다.
운영 규칙:
- 원본과 정리본을 분리한다.
- 이미 있는 주제/항목인지 먼저 확인한다.
- 새 항목이 필요하면 제목, 한 줄 요약, 핵심 내용, 관련 아이디어/링크, 연결 가능한 기존 항목 초안을 만든다.
- 기존 항목과 비슷하면 유사 의심으로 표시하고 병합/분리/연결 의견을 제안한다. 강제하지 않는다.
- 태그가 없으면 후보 분류를 붙이고, 애매하면 후보 여러 개/분류 대기로 남긴다.
- 개인정보/민감 내용은 노출하지 않고 경고만 남긴다.
- 새로 생긴 관심사/계속 파볼 것을 따로 목록화한다.
- 덮지 말고 갱신 이력을 우선한다.`;
}

export function computeSkillHash(): string {
  const prompt = loadSkillPrompt();
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export async function generateFromRecord(
  recordRawText: string,
  existingNodes: Array<{ id: string; title: string; summary: string; content: string; topics: string[]; tags: string[]; categories: string[] }>,
  relatedSegmentIds: string[],
  relatedRecordId: string,
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

  const systemPrompt = `<ai-wiki-SKILL.md>\n${skillPrompt}\n</ai-wiki-SKILL.md>\n\n출력은 반드시 JSON 객체 하나로만 반환한다.\n- 민감해 보이는 정보(비밀번호, 토큰, API키, 연락처, 비공개 링크, 사적 내용)가 보이면 본문에 쓰지 말고 민감정보 플래그로만 남긴다.\n- 기존 위키 노드가 있으면 먼저 읽고, 유사/중복 가능성이 있으면 병합/분리/연결 의견을 제안한다.\n- 새 노드는 제목, 한 줄 요약, 핵심 내용, 관련 아이디어/링크, 연결 가능한 기존 노드 후보를 제안한다.\n- 태그/분류가 없으면 후보 분류를 붙인다.\n- 제안 type은 '추가'|'갱신'|'분리'|'병합'|'연결'|'보강'|'수정' 중 하나여야 한다.\n- proposals.evidenceSegments에는 근거를 제공한 원문 세그먼트 id를 넣는다. 반드시 relatedSegmentIds 중 하나 이상이어야 한다.\n- proposals.relatedSegmentIds도 채운다.`;

  const userPrompt = `## 입력 대화/메모\n\n${recordRawText}\n\n## 기존 위키 노드 (있을 때만)\n\n${existingNodesText}\n\n## 출력\n\n{\n  "newNodes": [{"title":"...","summary":"...","content":"...","topics":["..."],"tags":["..."],"categories":["..."]}],\n  "proposals": [{"type":"...","targetNodeId":"...","sourceNodeId":"...","action":"...","reason":"...","evidence":"...","evidenceSegments":["..."],"before":{"summary":"...","content":"...","topics":["..."],"tags":["..."],"categories":["..."]},"after":{...},"relatedSegmentIds":["..."],"relatedRecordId":"..."}],\n  "interestCandidates": [{"interest":"...","snippet":"..."}],\n  "sensitiveInfo": {"hasSensitiveInfo":false,"warning":"...","nodeIds":["..."],"types":["..."]}\n}`;

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

  const raw = (() => {
    const choice = response.choices[0];
    if (!choice || !choice.message) return '';
    const msg = choice.message as { content?: string | null };
    return (msg.content ?? '').trim();
  })();

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
