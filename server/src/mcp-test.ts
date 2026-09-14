import { connectMcp, listTools } from "./mcpClient.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:3845/mcp";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

async function main() {
  console.log("연결 시도:", MCP_URL);

  let client;
  try {
    client = await connectMcp({ url: MCP_URL, authToken: AUTH_TOKEN });
  } catch (err: any) {
    console.error("MCP 연결 실패:", err?.message || err);
    process.exit(1);
  }

  try {
    const tools = await listTools(client);
    console.log("툴 목록 (%d개):", tools.length);
    for (const t of tools) {
      console.log("-", t.name, "::", t.description ?? "(설명 없음)");
    }
  } catch (err: any) {
    console.error("툴 목록 조회 실패:", err?.message || err);
  } finally {
    await client.close();
  }
}

main();
