import { Router } from 'express';
import { nodesRouter } from './nodes';
import { proposalsRouter } from './proposals';
import { recordsRouter } from './records';
import { chatsRouter } from './chats';

const router = Router();
router.use('/nodes', nodesRouter);
router.use('/proposals', proposalsRouter);
router.use('/records', recordsRouter);
router.use('/chats', chatsRouter);

export { router as apiRouter };
