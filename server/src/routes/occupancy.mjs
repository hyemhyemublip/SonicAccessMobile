/**
 * /occupancy — live headcount for dashboards.
 *
 *   GET /occupancy          { count, updatedAt, today: { in, out, net }, lastEventAt }
 *   GET /occupancy/events   recent access events (?limit=, default 50, max 500)
 *
 * Auth: read | node | admin token. If PUBLIC_OCCUPANCY=true, GET /occupancy is
 * open (kiosk display) but /occupancy/events still needs a token.
 */

import { Router } from 'express';

import { db } from '../db.mjs';
import { rolesFor } from '../auth.mjs';

export const occupancy = Router();

const PUBLIC = String(process.env.PUBLIC_OCCUPANCY || '').toLowerCase() === 'true';

const q = {
  current: db.prepare('SELECT count, updated_at FROM occupancy WHERE id = 1'),
  lastEvent: db.prepare('SELECT MAX(event_ts) AS ts FROM access_events'),
  sinceCounts: db.prepare(`
    SELECT direction, COUNT(*) AS n
    FROM access_events WHERE event_ts >= ?
    GROUP BY direction
  `),
  recent: db.prepare(`
    SELECT id, student_id AS studentId, gate_id AS gateId, direction,
           event_ts AS eventTs, counter, received_at AS receivedAt
    FROM access_events ORDER BY id DESC LIMIT ?
  `),
};

/** Start of the current UTC day, ISO. (Campus-local reporting is a display concern.) */
function startOfUtcDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

const hasReadRole = (req) =>
  rolesFor(req).some((r) => r === 'read' || r === 'node' || r === 'admin');

occupancy.get('/', (req, res) => {
  if (!PUBLIC && !hasReadRole(req)) {
    return res.status(401).json({ error: 'invalid or missing bearer token' });
  }
  const cur = q.current.get();
  const rows = q.sinceCounts.all(startOfUtcDay());
  const inN = rows.find((r) => r.direction === 'in')?.n ?? 0;
  const outN = rows.find((r) => r.direction === 'out')?.n ?? 0;
  res.json({
    count: cur.count,
    updatedAt: cur.updated_at,
    today: { in: inN, out: outN, net: inN - outN },
    lastEventAt: q.lastEvent.get().ts,
  });
});

occupancy.get('/events', (req, res) => {
  if (!hasReadRole(req)) {
    return res.status(401).json({ error: 'invalid or missing bearer token' });
  }
  const raw = Number(req.query.limit);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 500) : 50;
  res.json({ limit, events: q.recent.all(limit) });
});
