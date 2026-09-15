import { Router } from 'express';
import { nodesRouter } from './nodes';
import { proposalsRouter } from './proposals';
import { recordsRouter } from './records';
import { chatsRouter } from './chats';
import { searchRouter } from '../search/routes';


const router = Router();
router.use('/nodes', nodesRouter);
router.use('/proposals', proposalsRouter);
router.use('/records', recordsRouter);
router.use('/chats', chatsRouter);
router.use('/search', searchRouter);

export { router as apiRouter };
