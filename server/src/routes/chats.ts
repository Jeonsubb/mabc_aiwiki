import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateChatReplyWithContext, type ChatMessageRole } from '../solar';
import { buildChatWithContext, detectSearchIntent } from '../search/chat-context';

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
      orderBy: { updatedAt: 'desc' },
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
      return res.status(400).json({ status: 'error', error: '메시지 내용이 필요' });
    }

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true, userId: true },
    });

    if (!chat) {
      return res.status(404).json({ status: 'error', error: '대화방을 찾을 수 없음' });
    }

    if (chat.userId !== userId) {
      return res.status(403).json({ status: 'error', error: '이 대화방에 메시지를 보낼 수 없음' });
    }

    const trimmed = content.trim();

    // 1. 사용자 메시지 저장 (실패해도 이 메시지는 보존)
    const userMessage = await db.chatMessage.create({
      data: {
        chatId,
        role: 'user',
        content: trimmed,
        retryStatus: 'processing',
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // 2. Solar용 채팅 맥락(검색 맥락 포함) 빌드: 사용자 전체 대화방 기준
    const { context } = await buildChatWithContext(trimmed, { userId });

    // 방금 보낸 질문 자체는 검색 근거에서 제외
    const excMsgIds = new Set([userMessage.id]);
    context.pastMessages = context.pastMessages.filter((m) => !excMsgIds.has(m.messageId));

    // Solar 프롬프트용 대화 목록(이 채팅방의 기존 메시지)
    const existingMessages = await db.chatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });

    // 3. Solar 호출
    const reply = await generateChatReplyWithContext(
      existingMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      context,
    );

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
    const { messageId } = req.body as { messageId?: string };

    if (!messageId || typeof messageId !== 'string' || messageId.trim().length === 0) {
      return res.status(400).json({ status: 'error', error: '재시도할 메시지 id가 필요' });
    }

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true, userId: true },
    });

    if (!chat) {
      return res.status(404).json({ status: 'error', error: '대화방을 찾을 수 없음' });
    }

    if (chat.userId !== userId) {
      return res.status(403).json({ status: 'error', error: '이 대화방에 접근할 수 없음' });
    }

    // 대상 메시지 조회 + 소유자/대화방/role 검증
    const target = await db.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, role: true, content: true, createdAt: true, chatId: true, retryStatus: true },
    });

    if (!target) {
      return res.status(404).json({ status: 'error', error: '재시도 대상 메시지를 찾을 수 없음' });
    }

    if (target.role !== 'user') {
      return res.status(400).json({ status: 'error', error: '재시도 대상은 사용자 메시지여야 함' });
    }

    if (target.chatId !== chatId) {
      return res.status(403).json({ status: 'error', error: '이 대화방에 속한 메시지가 아님' });
    }

    if (target.retryStatus === 'processing') {
      return res.status(409).json({
        status: 'error',
        error: '이미 처리 중인 메시지',
        userMessage: target,
      });
    }

    if (target.retryStatus === 'done') {
      return res.status(200).json({
        status: 'already_answered',
        userMessage: target,
        pendingUserMessageId: null,
      });
    }

    if (target.retryStatus !== 'failed') {
      return res.status(409).json({
        status: 'error',
        error: '재시도할 수 없는 상태의 메시지',
        userMessage: target,
      });
    }

    // failed → processing CAS
    const casResult = await db.chatMessage.update({
      where: { id: target.id, retryStatus: 'failed' },
      data: { retryStatus: 'processing' },
    });

    if (!casResult) {
      const current = await db.chatMessage.findUnique({
        where: { id: target.id },
        select: { id: true, role: true, content: true, createdAt: true, retryStatus: true },
      });
      return res.status(409).json({
        status: 'error',
        error: '이미 처리 중인 메시지',
        userMessage: current ?? target,
      });
    }

    // 재시도 대상 메시지 기준 Solar용 채팅 맥락(검색 맥락 포함) 빌드
    const { context } = await buildChatWithContext(target.content, { userId });

    // 재시도 대상 메시지 자체는 과거 대화 검색 근거에서 제외
    const excMsgIds = new Set([target.id]);
    context.pastMessages = context.pastMessages.filter((m) => !excMsgIds.has(m.messageId));

    // 재시도 대상 메시지 기준으로 이전 메시지까지 가져와서 Solar 호출
    const existingMessages = await db.chatMessage.findMany({
      where: { chatId, createdAt: { lte: target.createdAt } },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });

    const reply = await generateChatReplyWithContext(
      existingMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      context,
    );

    if (reply.status !== 'success' || reply.content.length === 0) {
      // 실패: 대상 메시지 상태를 failed로 (processing 남기지 않음)
      await db.chatMessage.update({
        where: { id: target.id },
        data: { retryStatus: 'failed' },
      });

      return res.status(201).json({
        status: 'error',
        error: reply.error || 'AI 답변을 생성하지 못했음',
        userMessage: target,
      });
    }

    // 성공: 트랜잭션 안에서 답변 생성 + 완료 처리 + 채팅방 갱신
    const assistantMessage = await db.$transaction(async (tx) => {
      let answer;
      try {
        answer = await tx.chatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: reply.content,
            retryStatus: 'done',
            referencedMessageId: target.id,
          },
          select: { id: true, role: true, content: true, createdAt: true, retryStatus: true },
        });
      } catch (err: any) {
        // 유일성 제약 위반이면 이미 답변이 존재 -> 기존 답변 조회
        if ((err?.code === 'P2002' || String(err?.code ?? '').startsWith('P2002')) && err?.meta?.modelName === 'ChatMessage') {
          const existing = await tx.chatMessage.findFirst({
            where: { chatId, role: 'assistant', referencedMessageId: target.id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, role: true, content: true, createdAt: true, retryStatus: true },
          });
          if (!existing) throw err;
          answer = existing;
        } else {
          throw err;
        }
      }

      await tx.chatMessage.update({
        where: { id: target.id },
        data: { retryStatus: 'done' },
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return answer;
    });

    return res.status(201).json({
      status: 'success',
      userMessage: target,
      assistantMessage,
    });
  } catch (err) {
    console.error('chats POST /:id/retry error:', err);
    return res.status(500).json({ status: 'error', error: '서버 오류' });
  }
});
