import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { db, hashContent } from './db';
import { hashMcpToken } from './util/mcp-token';
import { Prisma } from '@prisma/client';
import { generateCandidatesForRecord, type CandidateGenerationResult } from './services/candidateGenerator';

async function submitConversationTool(userId: string, args: Record<string, unknown>) {
  const session_id = args['session_id'] as string | undefined;
  const conversation_text = args['conversation_text'] as string | undefined;
  const context = (args['context'] as Record<string, unknown>) ?? {};

  if (!session_id || !conversation_text) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'session_id와 conversation_text가 필요' }) },
      ],
    };
  }

  const contentHash = await hashContent(conversation_text);

  // 중복 입력 감지: 기존 record 확인
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
      // 이미 보관 + 후보 생성까지 완료된 레코드 → 기존 상태로 응답
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

    // 보관은 됐지만 후보 생성이 아직 안 된 레코드 → 재시도 경로 제공
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
            note: '보관된 대화지만 후보 생성이 완료되지 않았습니다. 동일 내용으로 재호출하면 후보 생성을 다시 시도합니다.',
          }),
        },
      ],
    };
  }

  try {
    const record = await db.$transaction(async (tx) => {
      const created = await tx.record.create({
        data: {
          userId,
          conversationId: session_id,
          source: 'mcp',
          rawText: conversation_text,
          contentHash,
          context: context as unknown as import('@prisma/client/runtime/library').InputJsonValue,
          status: '보관됨',
        },
      });
      await tx.conversationSegment.create({
        data: {
          recordId: created.id,
          segmentIndex: 0,
          rawStart: 0,
          rawEnd: conversation_text.length,
          rawText: conversation_text,
        },
      });
      return created;
    });

    // 원본 보관 트랜잭션 완료 후 공통 후보 생성 서비스 호출 (별도 트랜잭션)
    const candidateResult = await generateCandidatesForRecord(userId, record.id);

    const proposals = candidateResult.proposals;
    const generated = candidateResult.status === 'success' && proposals.length > 0;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            conversation_id: record.id,
            stored_at: record.createdAt.toISOString(),
            duplicated: false,
            status: candidateResult.status === 'success' ? '보관됨' : '보관됨_생성실패',
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
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: '보관 중 오류가 발생했습니다.' }),
        },
      ],
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
    description: '대화 원본을 보관 영역에 저장한다.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        conversation_text: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['session_id', 'conversation_text'],
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
