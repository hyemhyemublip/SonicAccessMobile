# server/

SonicAccess Phase 1 backend. Node + Express + SQLite (`node:sqlite`, built-in —
no native build). Separate `package.json`; run everything from `server/`.

Responsibilities:

- **Registry** — students and their versioned shared secrets.
- **Provisioning** — the registrar issues `studentId` + `secret` here (replaces
  the app's manual paste).
- **Secret distribution** — gate nodes **pull** the current `studentId → secret`
  map + the revoked list.
- **Ingest** — nodes POST accepted verifications; the server appends an
  `access_event` and moves the live occupancy count.
- **Occupancy** — live headcount read endpoint for dashboards.

Out of scope for this pass (planned): dashboard UI, nightly occupancy reset job,
manual-correction endpoint.

## Run

```bash
cd server
npm install
cp .env.example .env          # then set ADMIN_TOKEN / NODE_TOKEN / READ_TOKEN
npm run migrate               # apply schema.sql (idempotent)
npm run import-seed           # load ../seed/students.json into the DB
npm start                     # http://localhost:4000
```

`npm run dev` restarts on file changes. SQLite file is `DB_PATH` (default
`server/sonicaccess.db`); it and `.env` are gitignored.

## Auth

`Authorization: Bearer <token>`. Three roles, each an env token; a role with no
token set is refused (fail closed).

| Role    | Env           | Used by                                        |
| ------- | ------------- | -------------------------------------------- |
| `admin` | `ADMIN_TOKEN` | registrar / provisioning tools               |
| `node`  | `NODE_TOKEN`  | the ESP32 gate nodes                          |
| `read`  | `READ_TOKEN`  | dashboards / monitoring                       |

`GET /occupancy` also accepts `node` and `admin` tokens, and is open if
`PUBLIC_OCCUPANCY=true`.

## Endpoints

### Health
```
GET /health            -> { ok, db, rolesConfigured }
```

### Admin  (`ADMIN_TOKEN`)
```
POST /admin/students                     upsert student + set active secret
     { studentId, name, program?, section?, secret }
GET  /admin/students        [?withSecrets=1]
GET  /admin/students/:id    [?withSecret=1]
POST /admin/students/:id/rotate          { secret? }  -> new version (auto-gen if omitted)
POST /admin/students/:id/revoke          status=revoked, all secrets deactivated
```

### Nodes  (`NODE_TOKEN`)
```
GET /nodes/secrets  [?gateId=&direction=in|out]
    -> { generatedAt, revision, students:[{studentId,secret}], revoked:[studentId] }
```
`revision` is the newest student/secret change timestamp — a node can cache and
skip re-applying an unchanged map. Passing `gateId`+`direction` stamps node
liveness. Pull model: one URL, survives node reboot / brief LAN loss.

### Ingest  (`NODE_TOKEN`)
```
POST /ingest/events
     { studentId, gateId, direction: "in"|"out", eventTs: ISO8601, counter? }
     -> { recorded, duplicate, knownStudent, occupancy, occupancyUpdatedAt }
```
The node has already decoded + HOTP-verified (see `../src/PROTOCOL.md`); this
endpoint trusts an authenticated node. `in` → occupancy +1, `out` → −1 (floored
at 0). If `counter` is given, `gateId|studentId|counter` is unique — a retried
POST records once and moves the count once. An event for an unknown `studentId`
is still recorded (`knownStudent:false`) — the log is the source of truth.

### Occupancy
```
GET /occupancy          -> { count, updatedAt, today:{in,out,net}, lastEventAt }
GET /occupancy/events   [?limit=50]  (max 500)  -> recent access_events
```

## Schema (`src/schema.sql`)

`students` · `secrets` (versioned, one active per student) · `gate_nodes` ·
`access_events` (append-only — UPDATE/DELETE blocked by trigger; corrections are
new rows) · `occupancy` (single running counter).

## Notes / follow-ups

- `access_events.id` can skip a value when a duplicate POST hits
  `ON CONFLICT DO NOTHING` — cosmetic (SQLite reserves the rowid first).
- `today` counts use the **UTC** day boundary; campus-local reporting is a
  display concern for the dashboard.
- Occupancy drifts over time (tailgating, missed exits, reboots) — the nightly
  reset + manual-correction endpoint (deferred) will address this.
- Ingest trusts the node token. Re-verification at the backend would need the
  node to also send the raw code + counter; deliberately not done.
