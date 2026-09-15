import { Router } from 'express';
import { nodesRouter } from './nodes';
import { proposalsRouter } from './proposals';
import { recordsRouter } from './records';
import { searchRouter } from './search';

const router = Router();
router.use('/nodes', nodesRouter);
router.use('/proposals', proposalsRouter);
router.use('/records', recordsRouter);
router.use('/search', searchRouter);

export { router as apiRouter };
