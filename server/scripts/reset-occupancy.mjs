/**
 * Reset the live occupancy count. Talks to the DB directly — no running server
 * needed — and logs the reset to occupancy_adjustments (role 'system').
 *
 *   node --experimental-sqlite --env-file=.env scripts/reset-occupancy.mjs [to]
 *   npm run reset-occupancy            # -> 0
 *   npm run reset-occupancy -- 5       # -> 5
 *
 * Run nightly from cron / a systemd timer, e.g. 02:00:
 *   0 2 * * *  cd /opt/sonicaccess/server && npm run reset-occupancy >> /var/log/sonicaccess-reset.log 2>&1
 */

import { db, tx, nowIso } from '../src/db.mjs';

const arg = process.argv[2];
const to = arg == null ? 0 : Number(arg);
if (!Number.isInteger(to) || to < 0) {
  console.error(`usage: reset-occupancy.mjs [non-negative integer]  (got ${arg})`);
  process.exit(2);
}

const { previous, count } = tx(() => {
  const prev = db.prepare('SELECT count FROM occupancy WHERE id = 1').get().count;
  db.prepare('UPDATE occupancy SET count = ?, updated_at = ? WHERE id = 1').run(to, nowIso());
  db.prepare(
    `INSERT INTO occupancy_adjustments (kind, delta, prev_count, new_count, reason, role, created_at)
     VALUES ('reset', NULL, ?, ?, 'scheduled/manual reset', 'system', ?)`,
  ).run(prev, to, nowIso());
  return { previous: prev, count: to };
});

console.log(`occupancy reset: ${previous} -> ${count} @ ${nowIso()}`);
process.exit(0);
