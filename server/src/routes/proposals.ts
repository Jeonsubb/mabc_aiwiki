import { Router, Request, Response } from 'express';
import { MOCK_NODES } from './nodes';

export const proposalsRouter = Router();

const MOCK_PROPOSALS = [
  {
    id: 'prop_001',
    type: '추가' as const,
    targetNodeId: 'node_001',
    action: '기존 노드에 보강',
    reason: '새 대화에서 같은 주제(콘텐츠 기획 워크플로우)를 다시 다루며 결정 이유가 추가됨.',
    evidence: '대화 발췌: "주제 3개 중 2수준은 이렇게 잡고, 나머지는 나중에…"\n\n이전 노드에는 1,2만 있고 3수준 판단이 빠져 있음.',
    before: {
      summary: 'AI와 기획 대화를 주고받으며 콘텐츠 제작 워크플로우를 정리한 노드.',
      content: '## 핵심\n\n1. 주제 후보 3개 던지기\n2. 질문/반박 주고받기',
    },
    after: {
      summary: 'AI와 기획 대화를 주고받으며 콘텐츠 제작 워크플로우를 정리한 노드. (3수준 판단 기준 보강)',
      content: '## 핵심\n\n1. 주제 후보 3개 던지기\n2. 질문/반박 주고받기\n3. 3수준 판단은 보류하고 메모로 남기기',
    },
    status: '제안됨' as const,
  },
  {
    id: 'prop_002',
    type: '분리' as const,
    sourceNodeId: 'node_001',
    action: '새 노드로 분리',
    reason: '기존 노드 안에서 검토 기준이 별도 주제로 정리될 만해서 분리 제안.',
    evidence: '대화 중 "검토 기준을 따로 빼서 보는 게 좋겠다"는 발언.',
    before: {
      summary: '콘텐츠 기획 아이디어 — AI 협업 워크플로우',
      content: '## 핵심\n\n1. 주제 후보 3개 던지기\n2. 질문/반박 주고받기\n3. 검토 기준 포함',
    },
    after: {
      summary: '콘텐츠 기획 아이디어 — AI 협업 워크플로우 (검토 기준 분리됨)',
      content: '## 핵심\n\n1. 주제 후보 3개 던지기\n2. 질문/반박 주고받기\n\n## 관련\n\n- 검토 기준 정리 노드와 연결',
    },
    status: '제안됨' as const,
  },
];

proposalsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ proposals: MOCK_PROPOSALS });
});

proposalsRouter.get('/:id', (req: Request, res: Response) => {
  const p = MOCK_PROPOSALS.find((p) => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: '제안을 찾지 못함' });
  res.json({ proposal: p });
});

proposalsRouter.post('/:id/decide', (req: Request, res: Response) => {
  const p = MOCK_PROPOSALS.find((p) => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: '제안을 찾지 못함' });

  const { action } = req.body as { action: '수락' | '기각' };
  if (!action) return res.status(400).json({ error: 'action(수락/기각)이 필요' });

  if (action === '기각') {
    const nextStatus = '기각됨';
    const updated = { ...p, status: nextStatus as typeof p.status, decisionAction: action };
    return res.json({ proposal: updated });
  }

  // 수락 시 타겟 노드를 실제 반영
  let reflected = false;
  if (p.targetNodeId && p.after) {
    const targetNode = MOCK_NODES.find((n) => n.id === p.targetNodeId);
    if (targetNode) {
      if (p.after.summary !== undefined) targetNode.summary = p.after.summary;
      if (p.after.content !== undefined) targetNode.content = p.after.content;
      targetNode.updatedAt = new Date().toISOString();
      reflected = true;
    }
  }

  const nextStatus = reflected ? '반영됨' : '승인됨';
  const updated = {
    ...p,
    status: nextStatus as typeof p.status,
    decisionAction: action,
    decisionAt: new Date().toISOString(),
    reflected,
  };

  res.json({ proposal: updated });
});
