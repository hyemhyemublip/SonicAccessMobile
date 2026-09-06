/**
 * Express app wiring. Exported separately from `index.mjs` so tests can import
 * the app without binding a port.
 */

import express from 'express';

import { dbPath } from './db.mjs';
import { requireRole, tokenRolesConfigured } from './auth.mjs';
import { HttpError } from './validate.mjs';
import { admin } from './routes/admin.mjs';
import { nodes } from './routes/nodes.mjs';
import { ingest } from './routes/ingest.mjs';
import { occupancy } from './routes/occupancy.mjs';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use((req, _res, next) => {
    req._t0 = Date.now();
    next();
  });
  app.use((req, res, next) => {
    res.on('finish', () => {
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          m: req.method,
          p: req.originalUrl,
          s: res.statusCode,
          ms: Date.now() - req._t0,
        }),
      );
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, db: dbPath, rolesConfigured: tokenRolesConfigured() });
  });

  app.use('/admin', requireRole('admin'), admin);
  app.use('/nodes', requireRole('node'), nodes);
  app.use('/ingest', requireRole('node'), ingest);
  app.use('/occupancy', occupancy); // per-route auth (supports PUBLIC_OCCUPANCY)

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const msg = err.type === 'entity.too.large' ? 'request body too large' : 'invalid JSON body';
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: msg });
    }
    if (err instanceof HttpError || Number.isInteger(err?.status)) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    console.error('unhandled', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
