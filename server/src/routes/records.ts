import { Router, Request, Response } from 'express';

export const recordsRouter = Router();

const MOCK_RECORDS = [
  {
    id: 'rec_001',
    conversationId: 'conversation_001',
    source: 'solar_agent_conversation',
    receivedAt: new Date().toISOString(),
    status: '보관됨',
  },
];

recordsRouter.post('/', (req: Request, res: Response) => {
  const { rawText } = req.body as { rawText?: string };
  if (!rawText) return res.status(400).json({ error: 'rawText가 필요' });

  const record = {
    id: `rec_${Date.now()}`,
    conversationId: `conversation_${Date.now()}`,
    source: 'solar_agent_conversation',
    receivedAt: new Date().toISOString(),
    status: '보관됨',
  };

  res.status(201).json({ record });
});

recordsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ records: MOCK_RECORDS });
});
