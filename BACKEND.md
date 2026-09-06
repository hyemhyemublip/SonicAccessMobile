# SonicAccess backend

Design overview of the Phase 1 backend. Setup and the full endpoint reference
live in [`server/README.md`](server/README.md); this file is the "why" and the
shape.

## Where it fits

```
 registrar  ──POST /admin/students──►  ┌───────────┐  ◄──GET /nodes/secrets──  entry node ─┐
 (provision)                           │  backend  │                           exit  node ─┤ pull secret map
                                       │  (server/) │  ◄──POST /ingest/events──────────────┘ post accepted verifies
 dashboard  ──GET /occupancy────────►  └───────────┘
```

The **phone** never talks to the backend. It only emits the chirp. The backend
serves three actors:

| Actor            | Does                                              | Token         |
| ---------------- | ------------------------------------------------ | ------------- |
| Registrar tools  | create / rotate / revoke students + secrets       | `ADMIN_TOKEN` |
| Gate nodes (2)   | pull the secret map; report accepted verifies     | `NODE_TOKEN`  |
| Dashboards       | read the live occupancy count                     | `READ_TOKEN`  |

## Stack

Node + Express 5 + SQLite via `node:sqlite` (built-in — no native build step, no
DB server to run). One file DB (`server/sonicaccess.db`). Bearer-token auth,
three roles, fail closed (a role with no token set is refused).

## Data model (`server/src/schema.sql`)

| Table           | Purpose                                                        |
| --------------- | ------------------------------------------------------------- |
| `students`      | `student_id` (20-bit), name/program/section, `status` active\|revoked |
| `secrets`       | versioned per student; exactly one `active` (partial unique index). Raw string = the HMAC key the gate re-derives the rolling code with |
| `gate_nodes`    | `gate_id`, `direction` in\|out, `last_seen_at`                 |
| `access_events` | **append-only** (triggers block UPDATE/DELETE). One row per accepted verify. `dedupe_key = gate_id\|student_id\|counter` unique |
| `occupancy`     | single running counter, pinned `id = 1`                        |

## Flows

**Provisioning** — registrar `POST /admin/students {studentId, name, secret}` →
upsert student, deactivate any old secret, insert new version. `rotate` issues a
new version (auto-generated if no secret supplied); `revoke` sets `status` and
deactivates all secrets.

**Node secret sync (pull)** — node polls `GET /nodes/secrets` on a timer →
`{ students:[{studentId,secret}], revoked:[…], revision }`. Node caches locally
and keeps verifying if the backend is unreachable. `revision` is the newest
student/secret change timestamp, so a node can skip re-applying an unchanged
map. Pull (not push) so a rebooted / briefly-disconnected node self-heals with
no per-node addressing or retry queue.

**Entry / exit** — the node decodes the chirp and does the HOTP verify itself
(see [`src/PROTOCOL.md`](src/PROTOCOL.md)); on accept it
`POST /ingest/events {studentId, gateId, direction, eventTs, counter}`. The
backend appends the event and moves `occupancy` (`in` +1, `out` −1, floored at
0). If `counter` is present the event is idempotent — a retried POST records
once and moves the count once. An event for an unknown `studentId` is still
recorded (`knownStudent:false`); the log is the source of truth.

**Dashboard** — `GET /occupancy` → `{ count, updatedAt, today:{in,out,net},
lastEventAt }`. `GET /occupancy/events?limit=` returns recent rows.

## Security model

- All state-changing routes require a bearer token for the matching role.
- `ingest` trusts an authenticated node — it does **not** re-run the acoustic
  verify (that would need the node to also ship the raw code + counter).
- Token comparison is constant-time. `x-powered-by` disabled. JSON body capped
  at 64 KB.
- Sample secrets in `seed/students.json` are dev-only; production issues fresh
  secrets via `/admin/students` and never commits them.

## Not built yet (deferred from this pass)

- Dashboard UI (currently JSON endpoints only)
- Nightly occupancy reset job
- Manual-correction endpoint (append a correction event, never edit history)
- Delta sync / `If-None-Match` on `/nodes/secrets`
- Node-side offline event queue + flush semantics

See [`CONSIDERATIONS.md`](CONSIDERATIONS.md) for the open decisions behind these.
