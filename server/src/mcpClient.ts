import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamable-http.js";

export interface McpConnectionOpts {
  url: string;
  authToken?: string;
}

export async function connectMcp(opts: McpConnectionOpts) {
  const client = new Client({
    name: "mabc-client",
    version: "1.0.0",
  });

  const headers: Record<string, string> = {};
  if (opts.authToken) {
    headers["Authorization"] = `Bearer ${opts.authToken}`;
  }

  const url = new URL(opts.url);

  if (url.pathname.includes("/sse") || url.pathname.includes("sse")) {
    const transport = new SSEClientTransport(url, {
      fetch: (url: URL | RequestInfo, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        Object.entries(headers).forEach(([k, v]) => h.set(k, v));
        return fetch(url, { ...init, headers: h });
      },
    });
    await client.connect(transport);
  } else {
    const transport = new StreamableHTTPClientTransport(url, {
      requestHeaders: headers,
    });
    await client.connect(transport);
  }

  return client;
}

export async function listTools(client: Client) {
  const { tools } = await client.listTools();
  return tools;
}

export async function callTool(client: Client, toolName: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: toolName, arguments: args });
  return result;
}
