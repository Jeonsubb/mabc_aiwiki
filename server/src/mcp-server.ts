import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { db, hashContent } from './db';
import { Prisma } from '@prisma/client';

async function submitConversationTool(args: Record<string, unknown>) {
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

  const mcpUserEmail = process.env.MCP_USER_EMAIL;
  if (!mcpUserEmail) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'MCP_USER_EMAIL 환경변수가 설정되지 않음' }) },
      ],
    };
  }

  const user = await db.user.findUnique({ where: { email: mcpUserEmail } });
  if (!user) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'MCP_USER_EMAIL에 해당하는 사용자가 없음' }) },
      ],
    };
  }

  const contentHash = await hashContent(conversation_text);

  const existingRecord = await db.record.findUnique({
    where: { user_content_hash_unique: { userId: user.id, contentHash } },
  });
  if (existingRecord) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            conversation_id: existingRecord.id,
            stored_at: existingRecord.createdAt.toISOString(),
            duplicated: true,
          }),
        },
      ],
    };
  }

  try {
    const record = await db.$transaction(async (tx) => {
      const created = await tx.record.create({
        data: {
          userId: user.id,
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            conversation_id: record.id,
            stored_at: record.createdAt.toISOString(),
            duplicated: false,
          }),
        },
      ],
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existingRecord = await db.record.findUnique({
        where: { user_content_hash_unique: { userId: user.id, contentHash } },
      });
      if (existingRecord) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                conversation_id: existingRecord.id,
                stored_at: existingRecord.createdAt.toISOString(),
                duplicated: true,
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

async function listConversationsTool(args: Record<string, unknown>) {
  const limit = Math.min(Number(args['limit']) || 50, 200);

  const mcpUserEmail = process.env.MCP_USER_EMAIL;
  if (!mcpUserEmail) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'MCP_USER_EMAIL 환경변수가 설정되지 않음' }) },
      ],
    };
  }

  const user = await db.user.findUnique({ where: { email: mcpUserEmail } });
  if (!user) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'MCP_USER_EMAIL에 해당하는 사용자가 없음' }) },
      ],
    };
  }

  const records = await db.record.findMany({
    where: { userId: user.id },
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
    const mcpToken = process.env.MCP_INGEST_TOKEN ?? '';

    if (!mcpToken || authHeader !== `Bearer ${mcpToken}`) {
      res.status(401).json({ error: '인증 필요' });
      return;
    }

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
          return submitConversationTool(args);
        }
        if (name === 'list_conversations') {
          return listConversationsTool(args);
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
