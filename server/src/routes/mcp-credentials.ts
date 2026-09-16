import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { generateMcpToken } from '../util/mcp-token';

export const mcpCredentialsRouter = Router();

// --------------------------------------------------
// 내 MCP 연결 토큰 목록 조회
// --------------------------------------------------
mcpCredentialsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const credentials = await db.mcpCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        revokedAt: true,
      },
    });

    res.json({ credentials });
  } catch (err) {
    console.error('mcp credentials list error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// --------------------------------------------------
// MCP 연결 토큰 발급
// --------------------------------------------------
mcpCredentialsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const body = req.body as { name?: string };

    const name = body.name;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name이 필요' });
    }

    const { rawToken, hashHex } = generateMcpToken();

    // 원본 토큰은 로그에 절대 남기지 않는다.
    const created = await db.mcpCredential.create({
      data: {
        userId,
        name: name.trim(),
        tokenHash: hashHex,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        revokedAt: true,
      },
    });

    // 원문은 이 응답에서만 한 번 반환하고, 이후 목록/조회에는 포함하지 않는다.
    res.status(201).json({
      credential: created,
      token: rawToken,
    });
  } catch (err) {
    console.error('mcp credential create error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// --------------------------------------------------
// 내 MCP 연결 토큰 폐기 (revokedAt 설정)
// --------------------------------------------------
mcpCredentialsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const credentialId = req.params.id;

    if (!credentialId) {
      return res.status(400).json({ error: 'credential id가 필요' });
    }

    // 다른 사용자의 토큰은 조회하거나 폐기할 수 없다.
    const credential = await db.mcpCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!credential) {
      return res.status(404).json({ error: '토큰을 찾을 수 없음' });
    }

    const revokedAt = new Date();
    await db.mcpCredential.update({
      where: { id: credentialId },
      data: { revokedAt },
    });

    res.json({
      ok: true,
      revokedAt: revokedAt.toISOString(),
    });
  } catch (err) {
    console.error('mcp credential revoke error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// --------------------------------------------------
// 폐기된 MCP 연결 토큰 영구 삭제
// --------------------------------------------------
mcpCredentialsRouter.delete('/:id/permanent', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const credentialId = req.params.id;

    if (!credentialId) {
      return res.status(400).json({ error: 'credential id가 필요' });
    }

    const credential = await db.mcpCredential.findFirst({
      where: { id: credentialId, userId },
      select: { id: true, userId: true, revokedAt: true },
    });

    if (!credential) {
      return res.status(404).json({ error: '토큰을 찾을 수 없음' });
    }

    if (credential.revokedAt == null) {
      return res.status(409).json({ error: '활성 토큰은 삭제할 수 없습니다. 먼저 폐기하세요.' });
    }

    await db.mcpCredential.delete({ where: { id: credentialId } });

    res.json({ ok: true });
  } catch (err) {
    console.error('mcp credential permanent delete error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});
