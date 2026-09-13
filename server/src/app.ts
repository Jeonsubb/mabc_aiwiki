import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', apiRouter);

export { app };
