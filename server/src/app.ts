import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db-pool';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/auth';
import { apiRouter } from './routes';

const PgStore = connectPgSimple(session);

const app = express();
app.use(cors());
app.use(express.json());

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
      disableTouch: false,
    }),
    secret: process.env.SESSION_SECRET || 'mabc-dev-sid-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/api/auth', authRouter);
app.use('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', apiRouter);

export { app };
