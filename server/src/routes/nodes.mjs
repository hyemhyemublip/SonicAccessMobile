/**
 * /nodes
 *   GET /nodes/secrets   NODE_TOKEN   full studentId -> secret map + revoked list
 *   GET /nodes           read|node|admin   registered gate nodes + liveness
 *
 * Pull, not push: one well-known URL, so a node that reboots or briefly loses
 * the LAN just re-fetches and caches. The response carries an ETag = the newest
 * student/secret change timestamp (`revision`); a node that sends
 * `If-None-Match: "<revision>"` gets `304 Not Modified` and can skip re-applying
 * an unchanged map.
 */

import { Router } from 'express';

import { db, nowIso } from '../db.mjs';
import { requireRole } from '../auth.mjs';
import { oneOf, optStr } from '../validate.mjs';

export const nodes = Router();

const STALE_MS = 120_000; // no pull/event in this long -> flagged stale

const q = {
  activeMap: db.prepare(`
    SELECT s.student_id AS studentId, sec.secret AS secret
    FROM students s
    JOIN secrets sec ON sec.student_id = s.student_id AND sec.active = 1
    WHERE s.status = 'active'
    ORDER BY s.student_id
  `),
  revoked: db.prepare(
    "SELECT student_id AS studentId FROM students WHERE status = 'revoked' ORDER BY student_id",
  ),
  revision: db.prepare(`
    SELECT MAX(ts) AS revision FROM (
      SELECT MAX(updated_at) AS ts FROM students
      UNION ALL SELECT MAX(created_at) FROM secrets
    )
  `),
  touchNode: db.prepare(`
    INSERT INTO gate_nodes (gate_id, direction, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(gate_id) DO UPDATE SET
      direction = excluded.direction,
      last_seen_at = excluded.last_seen_at
  `),
  listNodes: db.prepare(
    'SELECT gate_id AS gateId, direction, label, last_seen_at AS lastSeenAt FROM gate_nodes ORDER BY gate_id',
  ),
};

nodes.get('/secrets', requireRole('node'), (req, res) => {
  const gateId = optStr(req.query.gateId, 'gateId', { max: 64 });
  const direction = req.query.direction
    ? oneOf(req.query.direction, 'direction', ['in', 'out'])
    : null;
  if (gateId && direction) q.touchNode.run(gateId, direction, nowIso());

  const revision = q.revision.get().revision;
  const etag = `"${revision ?? 'none'}"`;
  if (req.headers['if-none-match'] === etag) {
    res.set('ETag', etag);
    return res.status(304).end();
  }

  res.set('ETag', etag);
  res.json({
    generatedAt: nowIso(),
    revision,
    students: q.activeMap.all(),
    revoked: q.revoked.all().map((r) => r.studentId),
  });
});

nodes.get('/', requireRole('read', 'node', 'admin'), (_req, res) => {
  const now = Date.now();
  const list = q.listNodes.all().map((n) => ({
    ...n,
    stale: !n.lastSeenAt || now - Date.parse(n.lastSeenAt) > STALE_MS,
  }));
  res.json({ nodes: list, staleAfterMs: STALE_MS });
});
