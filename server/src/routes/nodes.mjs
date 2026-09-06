/**
 * /nodes — the gate nodes pull from here. Requires NODE_TOKEN.
 *
 *   GET /nodes/secrets   full studentId -> secret map + the revoked list
 *
 * Pull, not push: one well-known URL, so a node that reboots or briefly loses
 * the LAN just re-fetches and caches. `revision` is the newest student/secret
 * change timestamp — a node can skip re-applying if it is unchanged. (Delta
 * sync and ETag/If-None-Match can be layered on later.)
 */

import { Router } from 'express';

import { db, nowIso } from '../db.mjs';
import { oneOf, optStr } from '../validate.mjs';

export const nodes = Router();

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
};

nodes.get('/secrets', (req, res) => {
  // optional self-identification so the dashboard can show node liveness
  const gateId = optStr(req.query.gateId, 'gateId', { max: 64 });
  const direction = req.query.direction
    ? oneOf(req.query.direction, 'direction', ['in', 'out'])
    : null;
  if (gateId && direction) q.touchNode.run(gateId, direction, nowIso());

  res.json({
    generatedAt: nowIso(),
    revision: q.revision.get().revision,
    students: q.activeMap.all(),
    revoked: q.revoked.all().map((r) => r.studentId),
  });
});
