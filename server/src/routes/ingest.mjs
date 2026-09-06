/**
 * /ingest — gate nodes report accepted verifications. Requires NODE_TOKEN.
 *
 *   POST /ingest/events   { studentId, gateId, direction, eventTs, counter? }
 *
 * The node has already done the acoustic decode + HOTP verify (see
 * src/PROTOCOL.md). This endpoint trusts an authenticated node: it appends the
 * event and moves the live occupancy count (in -> +1, out -> -1, floored at 0).
 *
 * Idempotency: if `counter` is supplied, `gateId|studentId|counter` is a unique
 * key — a retried POST for the same rolling-window entry is recorded once and
 * moves the count once.
 */

import { Router } from 'express';

import { db, tx, nowIso } from '../db.mjs';
import { isoTimestamp, oneOf, optInt, str, studentId as vStudentId } from '../validate.mjs';

export const ingest = Router();

const q = {
  studentExists: db.prepare("SELECT 1 FROM students WHERE student_id = ?"),
  touchNode: db.prepare(`
    INSERT INTO gate_nodes (gate_id, direction, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(gate_id) DO UPDATE SET
      direction = excluded.direction,
      last_seen_at = excluded.last_seen_at
  `),
  insertEvent: db.prepare(`
    INSERT INTO access_events (student_id, gate_id, direction, event_ts, counter, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO NOTHING
  `),
  bumpOccupancy: db.prepare(
    "UPDATE occupancy SET count = MAX(0, count + ?), updated_at = ? WHERE id = 1",
  ),
  occupancy: db.prepare('SELECT count, updated_at FROM occupancy WHERE id = 1'),
};

ingest.post('/events', (req, res) => {
  const b = req.body ?? {};
  const id = vStudentId(b.studentId);
  const gateId = str(b.gateId, 'gateId', { max: 64 });
  const direction = oneOf(b.direction, 'direction', ['in', 'out']);
  const eventTs = isoTimestamp(b.eventTs, 'eventTs');
  const counter = optInt(b.counter, 'counter');
  const dedupeKey = counter == null ? null : `${gateId}|${id}|${counter}`;

  const knownStudent = !!q.studentExists.get(id);
  const delta = direction === 'in' ? 1 : -1;

  const result = tx(() => {
    q.touchNode.run(gateId, direction, nowIso());
    const ins = q.insertEvent.run(id, gateId, direction, eventTs, counter, dedupeKey);
    const duplicate = ins.changes === 0;
    if (!duplicate) q.bumpOccupancy.run(delta, nowIso());
    return { duplicate, occ: q.occupancy.get() };
  });

  res.status(result.duplicate ? 200 : 201).json({
    recorded: !result.duplicate,
    duplicate: result.duplicate,
    knownStudent,
    occupancy: result.occ.count,
    occupancyUpdatedAt: result.occ.updated_at,
  });
});
