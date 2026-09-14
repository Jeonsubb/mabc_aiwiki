import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const recordsRouter = Router();

function conversationsPath(): string {
  const env = process.env.MABC_MCP_STORE;
  if (env) {
    return path.join(env, 'conversations.json');
  }
  // MCP 서버(store.py)와 동일 기본값
  return path.join(os.homedir(), '.mabc-mcp-store', 'conversations.json');
}

function readConversations(): Array<{
  id: string;
  session_id: string;
  stored_at: string;
  conversation_text: string;
  context: Record<string, unknown>;
}> {
  const p = conversationsPath();
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as Array<{
      id: string;
      session_id: string;
      stored_at: string;
      conversation_text: string;
      context: Record<string, unknown>;
    }>;
  } catch {
    return [];
  }
}

recordsRouter.get('/', (_req: Request, res: Response) => {
  const records = readConversations();
  res.json({ records });
});
