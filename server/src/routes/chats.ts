import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateChatReply, type ChatMessageRole } from '../solar';

export const chatsRouter = Router();

function getUserId(req: Request): string {
  return (req as any).userId as string;
}

function toChatMessageRoles(messages: Array<{ role: string; content: string }>): ChatMessageRole[] {
  const roles: ChatMessageRole[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      roles.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      roles.push({ role: 'assistant', content: m.content });
    }
  }
  return roles;
}

function summarizeTitle(content: string): string {
  const firstLine = content.replace(/\s+/g, ' ').trim().slice(0, 60);
  return firstLine || '새 대화';
}

function capMessages(messages: Array<{ role: string; content: string; createdAt: Date }>): Array<{ role: string; content: string; createdAt: Date }> {
  // 대화와 AI 응답을 번갈아 유지하되, 최근 80개까지만 Solar에 전달
  if (messages.length <= 80) return messages;
  return messages.slice(messages.length - 80);
}

// ── 채팅방 목록 ──────────────────────────────────────────────────────────────

chatsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const chats = await db.chat.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });

    const result = chats.map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        title: c.title || '새 대화',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
        lastMessage: last ? { role: last.role, content: last.content, createdAt: last.createdAt } : null,
      };
    });

    return res.json({ chats: result });
  } catch (err) {
    console.error('chats GET error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 채팅방 생성 ───────────────────────────────────────────────────────────────

chatsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { title, firstMessage } = req.body as { title?: string; firstMessage?: string };

    const chatTitle = typeof title === 'string' && title.trim().length > 0
      ? title.trim().slice(0, 120)
      : (typeof firstMessage === 'string' ? summarizeTitle(firstMessage) : '새 대화');

    const chat = await db.chat.create({
      data: {
        userId,
        title: chatTitle,
      },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });

    return res.status(201).json({ chat });
  } catch (err) {
    console.error('chats POST (create) error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 채팅방 조회 ───────────────────────────────────────────────────────────────

chatsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const chatId = req.params.id;

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!chat) {
      return res.status(404).json({ error: '대화방을 찾을 수 없음' });
    }

    if (chat.userId !== userId) {
      return res.status(403).json({ error: '이 대화방에 접근할 수 없음' });
    }

    return res.json({
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messages: chat.messages,
      },
    });
  } catch (err) {
    console.error('chats GET /:id error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 메시지 전송 (사용자 메시지 저장 → Solar 호출 → AI 메시지 저장) ──────────

chatsRouter.post('/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const chatId = req.params.id;
    const { content } = req.body as { content?: string };

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: '메시지 내용이 필요' });
    }

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true, userId: true },
    });

    if (!chat) {
      return res.status(404).json({ error: '대화방을 찾을 수 없음' });
    }

    if (chat.userId !== userId) {
      return res.status(403).json({ error: '이 대화방에 메시지를 보낼 수 없음' });
    }

    const trimmed = content.trim();

    // 1. 사용자 메시지 저장 (실패해도 이 메시지는 보존)
    const userMessage = await db.chatMessage.create({
      data: {
        chatId,
        role: 'user',
        content: trimmed,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // 2. 채팅방 기존 메시지 불러오기 (전달용)
    const existingMessages = await db.chatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });

    const capped = capMessages(existingMessages);
    const solarMessages = toChatMessageRoles(capped);

    // 3. Solar 호출
    const reply = await generateChatReply(solarMessages);

    if (reply.status !== 'success' || reply.content.length === 0) {
      // 사용자 메시지는 이미 저장되어 있으므로 보존, AI 답변 실패로 응답
      return res.status(201).json({
        status: 'error',
        error: reply.error || 'AI 답변을 생성하지 못했음',
        pendingUserMessageId: userMessage.id,
        userMessage,
      });
    }

    // 4. AI 답변 저장
    const assistantMessage = await db.chatMessage.create({
      data: {
        chatId,
        role: 'assistant',
        content: reply.content,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // 채팅방 updatedAt 갱신
    await db.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json({
      status: 'success',
      userMessage,
      assistantMessage,
    });
  } catch (err) {
    console.error('chats POST /:id/messages error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ── 재시도 (지정된 사용자 메시지 또는 마지막 사용자 메시지로 다시 Solar 호출) ──

chatsRouter.post('/:id/retry', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const chatId = req.params.id;
    const { pendingUserId } = req.body as { pendingUserId?: string };

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true, userId: true },
    });

    if (!chat) {
      return res.status(404).json({ error: '대화방을 찾을 수 없음' });
    }

    if (chat.userId !== userId) {
      return res.status(403).json({ error: '이 대화방에 접근할 수 없음' });
    }

    // 지정된 메시지 id가 있으면 우선 확인
    let targetMessage: { id: string; role: string; content: string; createdAt: Date; chatId: string } | null = null;
    if (typeof pendingUserId === 'string' && pendingUserId.trim().length > 0) {
      targetMessage = await db.chatMessage.findUnique({
        where: { id: pendingUserId },
        select: { id: true, role: true, content: true, createdAt: true, chatId: true },
      });

      if (!targetMessage) {
        return res.status(404).json({ error: '재시도 대상 메시지를 찾을 수 없음' });
      }

      if (targetMessage.role !== 'user') {
        return res.status(400).json({ error: '재시도 대상은 사용자 메시지여야 함' });
      }

      if (targetMessage.chatId !== chatId) {
        return res.status(403).json({ error: '이 대화방에 속한 메시지가 아님' });
      }

      // 이미 해당 메시지 이후에 assistant 답변이 있으면 재시도 불필요
      const laterAnswer = await db.chatMessage.findFirst({
        where: {
          chatId,
          role: 'assistant',
          createdAt: { gt: targetMessage!.createdAt },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (laterAnswer) {
        return res.json({
          status: 'already_answered',
          lastMessage: targetMessage,
        });
      }
    }

    // 명시적 대상 없으면 마지막 메시지로 fallback
    if (!targetMessage) {
      const lastMessage = await db.chatMessage.findFirst({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, role: true, content: true, createdAt: true, chatId: true },
      });

      if (lastMessage && lastMessage.role === 'assistant') {
        return res.json({
          status: 'already_answered',
          lastMessage,
        });
      }

      if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: '재시도할 사용자 메시지가 없음' });
      }

      targetMessage = lastMessage;
    }

    // 재시도 대상 메시지 기준으로 이전 메시지까지 가져와서 Solar 호출
    const existingMessages = await db.chatMessage.findMany({
      where: { chatId, createdAt: { lte: targetMessage!.createdAt } },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });

    const capped = capMessages(existingMessages);
    const solarMessages = toChatMessageRoles(capped);

    const reply = await generateChatReply(solarMessages);

    if (reply.status !== 'success' || reply.content.length === 0) {
      return res.status(201).json({
        status: 'error',
        error: reply.error || 'AI 답변을 생성하지 못했음',
        pendingUserMessageId: targetMessage.id,
      });
    }

    // 답변 저장 직전에 다시 확인하여, race로 이미 답변이 생성됐으면
    // 새로 만들지 않고 기존 답변을 재사용한다.
    const existingAnswer = await db.chatMessage.findFirst({
      where: {
        chatId,
        role: 'assistant',
        createdAt: { gt: targetMessage!.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    let assistantMessage;
    if (existingAnswer) {
      assistantMessage = existingAnswer;
    } else {
      assistantMessage = await db.chatMessage.create({
        data: {
          chatId,
          role: 'assistant',
          content: reply.content,
        },
        select: { id: true, role: true, content: true, createdAt: true },
      });
    }

    await db.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json({
      status: 'success',
      assistantMessage,
    });
  } catch (err) {
    console.error('chats POST /:id/retry error:', err);
    return res.status(500).json({ error: '서버 오류' });
  }
});
