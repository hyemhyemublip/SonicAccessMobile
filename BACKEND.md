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
| `occupancy_adjustments` | audit of every out-of-band change to the count — operator adjust/reset and the nightly reset (`prev_count`, `new_count`, `reason`, `role`) |

## Flows

**Provisioning** — registrar `POST /admin/students {studentId, name, secret}` →
upsert student, deactivate any old secret, insert new version. `rotate` issues a
new version (auto-generated if no secret supplied); `revoke` sets `status` and
deactivates all secrets.

**Node secret sync (pull)** — node polls `GET /nodes/secrets` on a timer →
`{ students:[{studentId,secret}], revoked:[…], revision }`. Node caches locally
and keeps verifying if the backend is unreachable. The response carries
`ETag: "<revision>"`; a node that sends `If-None-Match` gets `304` and skips
re-applying an unchanged map. Pull (not push) so a rebooted / briefly-
disconnected node self-heals with no per-node addressing or retry queue.

**Entry / exit** — the node decodes the chirp and does the HOTP verify itself
(see [`src/PROTOCOL.md`](src/PROTOCOL.md)); on accept it
`POST /ingest/events {studentId, gateId, direction, eventTs, counter}`. The
backend appends the event and moves `occupancy` (`in` +1, `out` −1, floored at
0). If `counter` is present the event is idempotent — a retried POST records
once and moves the count once. An event for an unknown `studentId` is still
recorded (`knownStudent:false`); the log is the source of truth.

**Dashboard** — `GET /` serves a static page (no build) that polls
`/occupancy`, `/nodes`, `/occupancy/events` and shows the live count, today's
in/out/net, gate-node liveness, and recent events. An optional admin-token field
enables the adjust / reset controls.

**Corrections** — the count drifts (tailgating, missed exits, reboots).
`POST /occupancy/adjust {delta}` and `POST /occupancy/reset {to}` (admin) fix it;
both are logged to `occupancy_adjustments`. `npm run reset-occupancy` does the
same against the DB directly — schedule it nightly from cron.

## Security model

- All state-changing routes require a bearer token for the matching role.
- `ingest` trusts an authenticated node — it does **not** re-run the acoustic
  verify (that would need the node to also ship the raw code + counter).
- Token comparison is constant-time. `x-powered-by` disabled. JSON body capped
  at 64 KB.
- Sample secrets in `seed/students.json` are dev-only; production issues fresh
  secrets via `/admin/students` and never commits them.

## Tests

`server/` has `npm test` — 13 `node:test` cases against a throwaway SQLite file:
auth roles, student create/rotate/revoke, `/nodes/secrets` + ETag 304, ingest
(+1 / −1 / dedupe / floor / unknown student), occupancy read + today counts,
adjust/reset + validation, `/nodes` listing, malformed JSON, dashboard served.

## Testing without hardware

`scripts/gate-sim.mjs` (`npm run gate-sim`) stands in for the ESP32: it pulls
the secret map from this backend, decodes a WAV with `scripts/fsk-decoder.mjs`,
runs the HOTP verify, applies a replay cache, and POSTs to `/ingest/events`.
Run one instance per direction. Full flow: app records a chirp → `gate-sim`
decodes it → backend occupancy moves.

`npm run test:e2e` (root) automates that whole path in one run — boots the
backend on an ephemeral port with a temp DB, provisions a student, generates a
real chirp WAV, decodes + verifies it, POSTs the event, and asserts occupancy
+1 / −1, replay dedupe, floor-at-0, and the `/occupancy` + event-log responses.
It is the "every layer agrees" check across the modulator, the reference
decoder, the wire format, and backend ingest.

## Not built yet

- Delta sync body (only `If-None-Match`/`304` is done; otherwise the full map is
  sent)
- Node-side offline event queue + flush semantics
- Deploy automation (systemd unit / backup cron are documented in
  `server/README.md`, not scripted)

See [`CONSIDERATIONS.md`](CONSIDERATIONS.md) for the open decisions behind these.
