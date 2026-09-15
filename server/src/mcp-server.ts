import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { db, hashContent } from './db';
import { hashMcpToken } from './util/mcp-token';
import { Prisma } from '@prisma/client';
import { generateCandidatesForRecord, type CandidateGenerationResult } from './services/candidateGenerator';

function normalizeWhitespace(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

function reconstructedText(messages: Array<Record<string, unknown>>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

function validateMessages(messages: Array<Record<string, unknown>>): string | null {
  if (!messages || messages.length === 0) {
    return 'messages는 비어 있지 않은 배열이어야 합니다';
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') {
      return `messages[${i}]는 객체여야 합니다`;
    }
    const roleRaw = (m as Record<string, unknown>)['role'];
    const contentRaw = (m as Record<string, unknown>)['content'];
    const role = typeof roleRaw === 'string' ? roleRaw : undefined;
    const content = typeof contentRaw === 'string' ? contentRaw : undefined;
    if (role === undefined || content === undefined) {
      return `messages[${i}]는 role과 content가 필수이며 문자열이어야 합니다`;
    }
    if (!role.trim()) {
      return `messages[${i}].role은 비어 있을 수 없습니다`;
    }
    if (!content.trim()) {
      return `messages[${i}].content는 비어 있을 수 없습니다`;
    }
  }
  return null;
}

function normalizeContext(context: unknown): Record<string, unknown> {
  return (context && typeof context === 'object' && !Array.isArray(context))
    ? (context as Record<string, unknown>)
    : {};
}

async function submitConversationTool(userId: string, args: Record<string, unknown>) {
  const conversation_text = args['conversation_text'] as string | undefined;
  const context = normalizeContext(args['context']);
  const messagesRaw = args['messages'];
  const messages = Array.isArray(messagesRaw) ? messagesRaw : undefined;
  const source = (args['source'] as string) ?? undefined;

  const rawSessionId = args['session_id'];
  const rawSessionIdAlt = args['sessionId'];
  let resolvedSessionId: string | undefined;

  if (rawSessionId !== undefined && rawSessionId !== null) {
    if (typeof rawSessionId !== 'string') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'session_id는 문자열이어야 합니다' }) }],
      };
    }
    resolvedSessionId = rawSessionId;
  } else if (rawSessionIdAlt !== undefined && rawSessionIdAlt !== null) {
    if (typeof rawSessionIdAlt !== 'string') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId는 문자열이어야 합니다' }) }],
      };
    }
    resolvedSessionId = rawSessionIdAlt;
  }

  if (!resolvedSessionId || resolvedSessionId.trim() === '') {
    resolvedSessionId = `mcp-generated:${randomUUID()}`;
  } else {
    resolvedSessionId = resolvedSessionId.trim();
  }

  if (messagesRaw !== undefined && messagesRaw !== null) {
    if (!Array.isArray(messagesRaw)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'messages는 배열이어야 합니다' }) }],
      };
    }
    const validated = Array.isArray(messagesRaw) ? (messagesRaw as Array<Record<string, unknown>>) : undefined;
    if (!validated) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'messages는 배열이어야 합니다' }) }],
      };
    }
    const validationError = validateMessages(validated);
    if (validationError) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: validationError }) }],
      };
    }

    const reconstructed = reconstructedText(validated);

    if (conversation_text !== undefined && typeof conversation_text === 'string') {
      if (normalizeWhitespace(reconstructed) !== normalizeWhitespace(conversation_text)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  "messages와 conversation_text의 내용이 일치하지 않습니다. messages를 우선하며, 차이를 확인 후 다시 요청하세요.",
              }),
            },
          ],
        };
      }
    }

    const storedText = reconstructed;

    return await handleStoreAndGenerate(userId, resolvedSessionId, source, validated, storedText, context);
  }

  if (!conversation_text || typeof conversation_text !== 'string') {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'conversation_text가 필요' }) }],
    };
  }

  return await handleStoreAndGenerate(userId, resolvedSessionId, source, undefined, conversation_text, context);
}

async function handleStoreAndGenerate(
  userId: string,
  session_id: string,
  source: string | undefined,
  messages: Array<Record<string, unknown>> | undefined,
  rawText: string,
  context: Record<string, unknown>,
) {
  const contentHash = await hashContent(rawText);

  const existingRecord = await db.record.findUnique({
    where: { user_content_hash_unique: { userId, contentHash } },
  });
  if (existingRecord) {
    const proposals = await db.proposal.findMany({
      where: { relatedRecordId: existingRecord.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true },
    });

  if (proposals.length > 0 && existingRecord.status === '처리됨') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              conversation_id: existingRecord.id,
              stored_at: existingRecord.createdAt.toISOString(),
              duplicated: true,
              status: existingRecord.status,
              generated: true,
              proposals: proposals.map((p) => ({ id: p.id, type: p.type })),
              retryable: false,
              note: '이미 보관 및 후보 생성이 완료된 대화입니다.',
            }),
          },
        ],
      };
    }

    if (existingRecord.status === '실패' && proposals.length === 0) {
  const claimed = await db.record.updateMany({
    where: { id: existingRecord.id, status: '실패' },
    data: {
      status: '처리중',
      retryCount: { increment: 1 },
      errorMessage: null,
    },
  });

  if (claimed.count !== 1) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        conversation_id: existingRecord.id,
        duplicated: true,
        status: '처리중',
        generated: false,
        retryable: false,
        note: '이미 재처리 중입니다.',
      }) }],
    };
  }

  try {
    const result = await generateCandidatesForRecord(userId, existingRecord.id);
    const generated = result.status === 'success' && result.proposals.length > 0;
    const status = result.status === 'success'
      ? (generated ? '처리됨' : '제안 없음')
      : '실패';

    await db.record.update({
      where: { id: existingRecord.id },
      data: {
        status,
        errorMessage: result.status === 'success' ? null : result.error ?? '후보 생성 실패',
      },
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({
        conversation_id: existingRecord.id,
        stored_at: existingRecord.createdAt.toISOString(),
        duplicated: true,
        status,
        generated,
        proposals: result.proposals,
        retryable: status === '실패',
        candidate: {
          status: result.status,
          proposals: result.proposals,
          excluded: result.excluded,
          error: result.error,
        },
      }) }],
    };
  } catch (err) {
    await db.record.update({
      where: { id: existingRecord.id },
      data: {
        status: '실패',
        errorMessage: err instanceof Error ? err.message : '재처리 오류',
      },
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({
        conversation_id: existingRecord.id,
        duplicated: true,
        status: '실패',
        generated: false,
        retryable: true,
        error: '후보 재처리 중 오류가 발생했습니다.',
      }) }],
    };
  }
}

return {
  content: [{ type: 'text', text: JSON.stringify({
    conversation_id: existingRecord.id,
    stored_at: existingRecord.createdAt.toISOString(),
    duplicated: true,
    status: existingRecord.status,
    generated: existingRecord.status === '처리됨' && proposals.length > 0,
    proposals,
    retryable: false,
    note: existingRecord.status === '처리중'
      ? '이미 처리 중입니다.'
      : '현재 기록은 자동 재처리 대상이 아닙니다.',
  }) }],
};
  }

let createdRecordId: string | null = null;

  try {
    const record = await db.$transaction(async (tx) => {
      const created = await tx.record.create({
        data: {
          userId,
          conversationId: session_id,
          source: source ?? 'mcp',
          rawText,
          contentHash,
          context: context as unknown as import('@prisma/client/runtime/library').InputJsonValue,
          status: '처리중',
        },
      });

      if (messages) {
        let cursor = 0;
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          const role = (m.role as string);
          const content = (m.content as string);
          const segmentRawText = `${role}: ${content}`;
          await tx.conversationSegment.create({
            data: {
              recordId: created.id,
              segmentIndex: i,
              rawStart: cursor,
              rawEnd: cursor + segmentRawText.length,
              rawText: segmentRawText,
            },
          });
          cursor += segmentRawText.length;
          if (i < messages.length - 1) {
            cursor += 1;
          }
        }
      } else {
        await tx.conversationSegment.create({
          data: {
            recordId: created.id,
            segmentIndex: 0,
            rawStart: 0,
            rawEnd: rawText.length,
            rawText,
          },
        });
      }

      return created;
    });
    createdRecordId = record.id;
    const candidateResult = await generateCandidatesForRecord(userId, record.id);

    const proposals = candidateResult.proposals;
    const generated = candidateResult.status === 'success' && proposals.length > 0;
    const finalStatus = candidateResult.status === 'success'
      ? (generated ? '처리됨' : '제안 없음')
      : '실패';
    const errorMessage =
      candidateResult.status === 'success' ? undefined : candidateResult.error;

    await db.record.update({
      where: { id: record.id },
      data: { status: finalStatus, errorMessage },
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            conversation_id: record.id,
            stored_at: record.createdAt.toISOString(),
            duplicated: false,
            status: finalStatus,
            generated,
            retryable: !generated && candidateResult.status !== 'success',
            candidate: {
              status: candidateResult.status,
              proposals,
              interestCandidatesCount: candidateResult.interestCandidatesCount,
              sensitiveInfo: candidateResult.sensitiveInfo,
              error: candidateResult.error,
              excluded: candidateResult.excluded,
            },
          }),
        },
      ],
    };
  } catch (err) {
     if (createdRecordId) {
      const proposalCount = await db.proposal.count({
        where: { relatedRecordId: createdRecordId },
      });

      await db.record.update({
        where: { id: createdRecordId },
        data: {
          status: '실패',
          errorMessage: err instanceof Error ? err.message : '후보 생성 오류',
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify({
          conversation_id: createdRecordId,
          status: '실패',
          generated: false,
          retryable: proposalCount === 0,
          error: '후보 생성 중 오류가 발생했습니다.',
        }) }],
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existingRecord = await db.record.findUnique({
        where: { user_content_hash_unique: { userId, contentHash } },
      });
      if (existingRecord) {
        const proposals = await db.proposal.findMany({
          where: { relatedRecordId: existingRecord.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true },
        });

        if (proposals.length > 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  conversation_id: existingRecord.id,
                  stored_at: existingRecord.createdAt.toISOString(),
                  duplicated: true,
                  status: existingRecord.status,
                  generated: true,
                  proposals: proposals.map((p) => ({ id: p.id, type: p.type })),
                  retryable: false,
                  note: '동시 요청이 이미 처리되었습니다.',
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                conversation_id: existingRecord.id,
                stored_at: existingRecord.createdAt.toISOString(),
                duplicated: true,
                status: existingRecord.status,
                generated: false,
                retryable: true,
                note: '보관은 완료됐으나 후보 생성이 실행되지 않았습니다. 동일 내용으로 재호출하면 후보 생성을 시도합니다.',
              }),
            },
          ],
        };
      }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: '보관 중 오류가 발생했습니다.' }) }],
    };
  }
}

async function listConversationsTool(userId: string, args: Record<string, unknown>) {
  const limit = Math.min(Number(args['limit']) || 50, 200);

  const records = await db.record.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const frontRecords = records.map((record) => ({
    id: record.id,
    session_id: record.conversationId,
    stored_at: record.createdAt.toISOString(),
    conversation_text: record.rawText,
    context: (record.context as Record<string, unknown>) ?? {},
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(frontRecords) }],
  };
}

const tools = [
  {
    name: 'submit_conversation',
    description: '대화 원본을 보관 영역에 저장한다. messages(역할 구분 메시지 목록, role/content 필수) 또는 기존 conversation_text로 원문 구간을 전달한다. 둘 다 제공하면 messages를 원문 구간의 1차 출처로 보고, messages를 role과 함께 이어 붙인 재구성 텍스트와 conversation_text가 실질적으로 같은지 검사한다. 다르면 오류로 처리한다(messages 우선). messages가 있으면 각 메시지의 role과 content가 필수이며, 비어 있을 수 없다. record_id와 timestamp는 선택이며, 알 수 없는 값을 만들어 넣지 않는다. source는 전송 출처 구분용 선택 필드다. session_id는 선택이며, 없으면 서버가 mcp-generated:(randomUUID) 형식의 식별자를 생성한다. MCP 프로토콜의 Mcp-Session-Id는 이 도구의 입력과 무관하게 서버가 별도로 처리한다. MVP에서는 사용자가 명시적으로 위키 저장 요청을 했을 때만 호출된다고 가정하며, 자동 전송/주기 전송/대화 종료 자동 위키화는 범위 밖이다.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        sessionId: { type: 'string' },
        conversation_text: { type: 'string' },
        context: { type: 'object' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
              record_id: { type: 'string' },
              timestamp: { type: 'string' },
            },
            required: ['role', 'content'],
          },
        },
        source: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'list_conversations',
    description: '보관된 대화 기록 목록을 최신순으로 조회한다.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
      required: [],
    },
  },
];

export function createMcpRouter() {
  const router = Router();

  router.post('/', async (req, res) => {
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '인증 필요' });
      return;
    }
    const rawToken = authHeader.slice(7);
    if (!rawToken) {
      res.status(401).json({ error: '인증 필요' });
      return;
    }

    const tokenHash = hashMcpToken(rawToken);
    const credential = await db.mcpCredential.findFirst({
      where: { tokenHash, revokedAt: null },
      select: { userId: true },
    });
    if (!credential) {
      res.status(401).json({ error: '인증 필요' });
      return;
    }

    const userId = credential.userId;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = new Server(
      { name: 'mabc-wiki-api', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const name = request.params.name;
        const args = request.params.arguments as Record<string, unknown>;

        if (name === 'submit_conversation') {
          return submitConversationTool(userId, args);
        }
        if (name === 'list_conversations') {
          return listConversationsTool(userId, args);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `알 수 없는 도구: ${name}` }),
            },
          ],
        };
      },
    );

    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
