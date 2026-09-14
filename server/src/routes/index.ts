import { Router } from 'express';
import { nodesRouter } from './nodes';
import { proposalsRouter } from './proposals';
import { recordsRouter } from './records';

const router = Router();
router.use('/nodes', nodesRouter);
router.use('/proposals', proposalsRouter);
router.use('/records', recordsRouter);

export { router as apiRouter };
