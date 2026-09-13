import { Router, Request, Response } from 'express';

export const nodesRouter = Router();

const MOCK_NODES = [
  {
    id: 'node_001',
    title: '콘텐츠 기획 아이디어 — AI 협업 워크플로우',
    summary: 'AI와 기획 대화를 주고받으며 콘텐츠 제작 워크플로우를 정리한 노드.',
    content: '## 핵심\n\n블로그/콘텐츠 기획할 때 AI와 어떤 순서로 대화하면 좋은지 정리.\n\n1. 주제 후보 3개 정도 던지기\n2. 각 주제별로 질문/반박 주고받기\n3. 결정 이유 기록\n\n## 관련\n\n- 이전에 했던 "검토 기준 정리" 대화와 연결 가능',
    topics: ['콘텐츠 기획', 'AI 협업', '워크플로우'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'node_002',
    title: '검토 기준 정리',
    summary: '주제 3개 중 뭘 먼저 다룰지 검토한 기준.',
    content: '## 기준\n\n- 사용자 반응 가능성\n- 제작 난이도\n- 기존 콘텐츠와의 중복\n\n## 결정\n\n우선순위 1, 2는 진행, 3은 보류.',
    topics: ['검토', '우선순위'],
    updatedAt: new Date().toISOString(),
  },
];

nodesRouter.get('/', (_req: Request, res: Response) => {
  res.json({ nodes: MOCK_NODES });
});

nodesRouter.get('/:id', (req: Request, res: Response) => {
  const node = MOCK_NODES.find((n) => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: '노드를 찾지 못함' });
  res.json({ node });
});
