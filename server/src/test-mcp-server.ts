import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  SamplingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";

const server = new Server(
  { name: "mabc-test-server", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      sampling: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "echo",
        description: "입력을 그대로 돌려주는 테스트 툴",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
      {
        name: "get_conversation_records",
        description: "타임리 에이전트 대화 예시를 모킹해서 돌려주는 툴(대상자용)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo") {
    const msg = (request.params.arguments as any)?.message ?? "";
    return {
      content: [{ type: "text", text: `echo: ${msg}` }],
    };
  }
  if (request.params.name === "get_conversation_records") {
    const limit = (request.params.arguments as any)?.limit ?? 5;
    const records = [
      {
        id: "rec-1",
        conversationId: "conv-aaa",
        source: "timeline_agent",
        receivedAt: new Date().toISOString(),
        status: "received",
        messages: [
          { role: "user", text: "MABC 위키 구조 짜줘" },
          { role: "assistant", text: "MABC 폴더를 이렇게 잡는 건 어때요..." },
        ],
      },
      {
        id: "rec-2",
        conversationId: "conv-bbb",
        source: "timeline_agent",
        receivedAt: new Date().toISOString(),
        status: "received",
        messages: [
          { role: "user", text: "MCP 클라이언트 연결 방법 알려줘" },
          { role: "assistant", text: "MCP SDK로 SSE/Streamable HTTP 둘 중..." },
        ],
      },
    ];
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(records.slice(0, limit), null, 2),
        },
      ],
    };
  }
  throw new Error(`알 수 없는 툴: ${request.params.name}`);
});

const httpServer = createServer((req, res) => {
  server.handleHttpRequest(req, res);
});

const PORT = Number(process.env.TEST_MCP_PORT || 4199);
httpServer.listen(PORT, () => {
  console.log(`테스트 MCP 서버 실행: http://localhost:${PORT}/mcp (Streamable HTTP)`);
});
