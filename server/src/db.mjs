/**
 * SQLite handle (node:sqlite, built-in — no native build step).
 *
 * Opens `DB_PATH`, applies `schema.sql` (idempotent) on load, and exports the
 * connection plus a tiny `tx()` helper for atomic multi-statement writes.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(process.env.DB_PATH || join(HERE, '..', 'sonicaccess.db'));

export const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));

export const dbPath = DB_PATH;

/** Run `fn` inside a transaction; rolls back if it throws. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
