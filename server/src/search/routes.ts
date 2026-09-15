import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  parseChatSearchParams,
  checkChatOwner,
  searchChatMessages,
  parseWikiSearchParams,
  searchWikiNodes,
} from './queries';

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

const router = Router();

// ── 채팅 메시지 검색 ───────────────────────────────────────────────────────────

router.get('/chat-messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const filters = parseChatSearchParams({
      q: req.query.q as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      chatId: req.query.chatId as string | undefined,
      limit: req.query.limit as string | undefined,
      offset: req.query.offset as string | undefined,
    });

    if (filters.invalid.length > 0) {
      return res.status(400).json({
        error: filters.invalid[0].message,
        invalid: filters.invalid,
      });
    }

    let effectiveChatId: string | undefined;
    if (
      req.query.chatId &&
      typeof req.query.chatId === 'string' &&
      req.query.chatId.trim().length > 0
    ) {
      const check = await checkChatOwner(req.query.chatId.trim(), userId);
      if (!check.ok) {
        return res.status(check.status).json({ error: check.error });
      }
      effectiveChatId = check.chatId;
    }

    const { results, total } = await searchChatMessages(userId, filters, effectiveChatId);

    return res.json({ results, total, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    console.error('search chat-messages error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 위키 노드 검색 ─────────────────────────────────────────────────────────────

router.get('/wiki-nodes', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const filters = parseWikiSearchParams({
      q: req.query.q as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      status: req.query.status as string | undefined,
      limit: req.query.limit as string | undefined,
      offset: req.query.offset as string | undefined,
    });

    if (filters.invalid.length > 0) {
      return res.status(400).json({
        error: filters.invalid[0].message,
        invalid: filters.invalid,
      });
    }

    const { results, total } = await searchWikiNodes(userId, filters);

    return res.json({ results, total, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    console.error('search wiki-nodes error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export { router as searchRouter };
