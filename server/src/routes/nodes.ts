import { Router, Request, Response as ExpressResponse } from 'express';

export const nodesRouter = Router();

const PYTHON_API_BASE = process.env.PYTHON_API_BASE || 'http://127.0.0.1:8765';
const PYTHON_AUTH_HEADER = process.env.PYTHON_AUTH_HEADER || 'X-Dummy-User';
const PYTHON_AUTH_VALUE = process.env.PYTHON_AUTH_VALUE || 'mabc-web';

async function pyFetch(path: string): Promise<Response> {
  const res = await fetch(`${PYTHON_API_BASE}${path}`, {
    headers: {
      [PYTHON_AUTH_HEADER]: PYTHON_AUTH_VALUE,
    },
  });
  return res;
}

/**
 * GET /api/nodes
 *
 * 실제 파이썬 FastAPI(/api/wiki/nodes)를 호출한다.
 * 파이썬 호출이 실패하면 빈 목록/목데이터로 숨기지 않고, HTTP 상태와 응답 본문을 그대로 내려준다.
 * 저장된 노드가 없어서 빈 배열([])이더라도 정상 응답(200)으로 그대로 노출한다.
 *
 * 노드→화면 변환(프론트 렌더링)은 아직 검증되지 않았다. 지금은 API 연결만 확인한다.
 */
nodesRouter.get('/', async (_req: Request, res: ExpressResponse) => {
  try {
    const pyRes = await pyFetch('/api/wiki/nodes');

    if (!pyRes.ok) {
      const body = await pyRes.text().catch(() => '');
      return res.status(pyRes.status).json({
        error: '파이썬 위키 노드 조회 실패',
        status: pyRes.status,
        detail: body || '(빈 응답)',
      });
    }

    const data = (await pyRes.json().catch(() => null)) as
      | { nodes?: unknown[]; count?: number }
      | null;

    if (!data || !Array.isArray(data.nodes)) {
      return res.status(502).json({
        error: '파이썬 응답 형식이 예상과 다름',
        detail: JSON.stringify(data),
      });
    }

    return res.json({ nodes: data.nodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({
      error: '파이썬 위키 노드 조회 중 오류',
      detail: message,
    });
  }
});

// ※ 이번 태스크 범위: GET /만 실제 파이썬 API 연동.
//    /:id 라우트는 건드리지 않음 (기존 동작 유지 대상 외).
