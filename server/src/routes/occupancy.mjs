/**
 * /occupancy — live headcount + operator corrections.
 *
 *   GET  /occupancy               { count, updatedAt, today:{in,out,net}, lastEventAt }
 *   GET  /occupancy/events        recent access events (?limit=, default 50, max 500)
 *   GET  /occupancy/adjustments   recent operator corrections + resets
 *   POST /occupancy/adjust        ADMIN  { delta: non-zero int, reason? }
 *   POST /occupancy/reset         ADMIN  { to?: int>=0 (default 0), reason? }
 *
 * Reads: read | node | admin token (GET /occupancy is open if
 * PUBLIC_OCCUPANCY=true). Writes: admin token only. Every write is logged to
 * occupancy_adjustments — access_events stays purely gate traffic.
 */

import { Router } from 'express';

import { db, tx, nowIso } from '../db.mjs';
import { rolesFor, requireRole } from '../auth.mjs';
import { HttpError } from '../validate.mjs';

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
  setCount: db.prepare('UPDATE occupancy SET count = ?, updated_at = ? WHERE id = 1'),
  logAdjust: db.prepare(`
    INSERT INTO occupancy_adjustments (kind, delta, prev_count, new_count, reason, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  recentAdjust: db.prepare(`
    SELECT id, kind, delta, prev_count AS prevCount, new_count AS newCount,
           reason, role, created_at AS createdAt
    FROM occupancy_adjustments ORDER BY id DESC LIMIT ?
  `),
};

/** Apply an out-of-band change and log it. Returns { previous, count }. */
function applyChange({ kind, delta = null, to = null, reason, role }) {
  return tx(() => {
    const prev = q.current.get().count;
    const next = kind === 'reset' ? to : Math.max(0, prev + delta);
    q.setCount.run(next, nowIso());
    q.logAdjust.run(kind, delta, prev, next, reason ?? null, role, nowIso());
    return { previous: prev, count: next };
  });
}

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

const clampLimit = (v, def = 50, max = 500) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : def;
};

occupancy.get('/events', (req, res) => {
  if (!hasReadRole(req)) {
    return res.status(401).json({ error: 'invalid or missing bearer token' });
  }
  const limit = clampLimit(req.query.limit);
  res.json({ limit, events: q.recent.all(limit) });
});

occupancy.get('/adjustments', (req, res) => {
  if (!hasReadRole(req)) {
    return res.status(401).json({ error: 'invalid or missing bearer token' });
  }
  const limit = clampLimit(req.query.limit, 50, 200);
  res.json({ limit, adjustments: q.recentAdjust.all(limit) });
});

occupancy.post('/adjust', requireRole('admin'), (req, res) => {
  const delta = req.body?.delta;
  if (!Number.isInteger(delta) || delta === 0) {
    throw new HttpError(400, 'delta must be a non-zero integer');
  }
  const reason = req.body?.reason == null ? null : String(req.body.reason).slice(0, 500);
  res.json({ ...applyChange({ kind: 'adjust', delta, reason, role: 'admin' }), delta });
});

occupancy.post('/reset', requireRole('admin'), (req, res) => {
  const raw = req.body?.to;
  const to = raw == null ? 0 : raw;
  if (!Number.isInteger(to) || to < 0) throw new HttpError(400, 'to must be an integer >= 0');
  const reason = req.body?.reason == null ? null : String(req.body.reason).slice(0, 500);
  res.json(applyChange({ kind: 'reset', to, reason, role: 'admin' }));
});
