-- SonicAccess Phase 1 backend schema (SQLite).
-- Applied on every start by db.mjs; all statements are idempotent.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ students
CREATE TABLE IF NOT EXISTS students (
  student_id  INTEGER PRIMARY KEY,             -- 20-bit payload field: 0 .. 1048575
  name        TEXT    NOT NULL,
  program     TEXT,
  section     TEXT,
  status      TEXT    NOT NULL DEFAULT 'active'  -- 'active' | 'revoked'
                CHECK (status IN ('active', 'revoked')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ------------------------------------------------------------------- secrets
-- Versioned. Exactly one active row per student (partial unique index).
-- The raw string is the HMAC key the gate re-derives the rolling code with.
CREATE TABLE IF NOT EXISTS secrets (
  student_id  INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  secret      TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,        -- 1 = current, 0 = superseded/revoked
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (student_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_secrets_one_active
  ON secrets(student_id) WHERE active = 1;

-- --------------------------------------------------------------- gate_nodes
CREATE TABLE IF NOT EXISTS gate_nodes (
  gate_id      TEXT PRIMARY KEY,
  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  label        TEXT,
  last_seen_at TEXT
);

-- ------------------------------------------------------------- access_events
-- Append-only. No UPDATE/DELETE (enforced by triggers). Corrections are new
-- rows, never edits.
CREATE TABLE IF NOT EXISTS access_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL,
  gate_id     TEXT    NOT NULL,
  direction   TEXT    NOT NULL CHECK (direction IN ('in', 'out')),
  event_ts    TEXT    NOT NULL,                 -- ISO 8601 UTC, from the node
  counter     INTEGER,                          -- rolling-window counter, for dedupe
  dedupe_key  TEXT UNIQUE,                      -- 'gate_id|student_id|counter' or NULL
  received_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_events_event_ts ON access_events(event_ts);
CREATE INDEX IF NOT EXISTS ix_events_student  ON access_events(student_id);

CREATE TRIGGER IF NOT EXISTS access_events_no_update
BEFORE UPDATE ON access_events
BEGIN SELECT RAISE(ABORT, 'access_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS access_events_no_delete
BEFORE DELETE ON access_events
BEGIN SELECT RAISE(ABORT, 'access_events is append-only'); END;

-- ---------------------------------------------------------------- occupancy
-- Single running counter (id is pinned to 1).
CREATE TABLE IF NOT EXISTS occupancy (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO occupancy(id, count) VALUES (1, 0);
