/**
 * Load ../../seed/students.json into the database: upsert each student and set
 * their active secret to the one in the seed file. Idempotent — re-running
 * re-syncs names and (re)activates the seed secret as a new version.
 *
 *   npm run import-seed
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, tx, nowIso } from '../src/db.mjs';
import { MAX_STUDENT_ID } from '../src/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', '..', 'seed', 'students.json');

const doc = JSON.parse(readFileSync(SEED, 'utf8'));
if (!Array.isArray(doc.students)) {
  console.error(`${SEED}: no students array`);
  process.exit(1);
}

const q = {
  upsertStudent: db.prepare(`
    INSERT INTO students (student_id, name, program, section, status, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?)
    ON CONFLICT(student_id) DO UPDATE SET
      name = excluded.name, program = excluded.program,
      section = excluded.section, status = 'active', updated_at = excluded.updated_at
  `),
  maxVersion: db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM secrets WHERE student_id = ?'),
  activeSecret: db.prepare('SELECT secret FROM secrets WHERE student_id = ? AND active = 1'),
  deactivate: db.prepare('UPDATE secrets SET active = 0 WHERE student_id = ? AND active = 1'),
  insertSecret: db.prepare(
    'INSERT INTO secrets (student_id, version, secret, active, created_at) VALUES (?, ?, ?, 1, ?)',
  ),
};

let added = 0;
let secretsSet = 0;
let skipped = 0;

tx(() => {
  for (const s of doc.students) {
    const id = Number(s.studentId);
    if (!Number.isInteger(id) || id < 0 || id > MAX_STUDENT_ID || !s.secret) {
      skipped++;
      continue;
    }
    q.upsertStudent.run(id, String(s.name ?? `student ${id}`), s.program ?? null, s.section ?? null, nowIso());
    added++;

    const current = q.activeSecret.get(id);
    if (current?.secret === s.secret) continue; // already the active secret
    const version = q.maxVersion.get(id).v + 1;
    q.deactivate.run(id);
    q.insertSecret.run(id, version, s.secret, nowIso());
    secretsSet++;
  }
});

console.log(
  `import-seed: ${added} students upserted, ${secretsSet} secrets (re)activated, ${skipped} skipped`,
);
process.exit(0);
