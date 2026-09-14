import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { db } from './db';

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

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(conversation_text));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const record = await db.record.create({
    data: {
      userId: 'system',
      conversationId: session_id,
      source: 'mcp',
      rawText: conversation_text,
      contentHash: `content_sha256$${hashHex}`,
      context: context as unknown as import('@prisma/client/runtime/library').InputJsonValue,
      status: '보관됨',
    },
  });

  await db.conversationSegment.create({
    data: {
      recordId: record.id,
      segmentIndex: 0,
      rawStart: 0,
      rawEnd: conversation_text.length,
      rawText: conversation_text,
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          conversation_id: record.id,
          stored_at: record.createdAt.toISOString(),
        }),
      },
    ],
  };
}

async function listConversationsTool(args: Record<string, unknown>) {
  const limit = Math.min(Number(args['limit']) || 50, 200);

  const records = await db.record.findMany({
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

  const transport = new StreamableHTTPServerTransport({});

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

  router.post('/mcp', async (req, res) => {
    const authHeader = req.headers.authorization ?? '';
    const mcpToken = process.env.MCP_AUTH_TOKEN ?? '';
    if (mcpToken && authHeader !== `Bearer ${mcpToken}`) {
      res.status(401).json({ error: '인증 필요' });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
