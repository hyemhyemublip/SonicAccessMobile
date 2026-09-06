# Considerations & open questions

Running notes on things to decide, verify, or handle before the SonicAccess
Phase 1 client is production-ready. Not bugs — design/deployment decisions.
Add to this as they come up; move resolved items to a "Decided" section with the
outcome.

---

## Offline operation

**Goal: the app works with no connectivity at the gate.** Current state — the
running app makes zero network calls (token derivation, WAV synthesis, playback,
credential read are all local). Conditions to keep it that way:

- **Ship a standalone build, not Expo Go.** Expo Go needs the Metro dev server.
  An EAS build / local prebuild bundles the JS and launches air-gapped. The
  `expo-audio` config plugin is already declared; a native build picks it up.
- **No OTA updates.** `expo-updates` is not installed, so the app never checks
  in for a new bundle. Keep it that way for an air-gapped gate, or gate the
  update check behind connectivity if it's added later.
- **Android `INTERNET` permission** is not needed for any app function. Expo
  adds it by default — decide whether to strip it in `app.json` so the build is
  provably offline.
- If you later add registrar provisioning (auto-issue id+secret instead of
  paste), that one enrollment call needs network — after that, offline again.

## Clock drift (rolling-window dependency)

The 6-digit code is `HOTP(secret, floor(now / 15s))`. The gate accepts the
current window ± 1 (~45 s of total slack).

- **Phone clock** must stay within that slack of real time. "Automatic date &
  time" on the device handles it (syncs via cell NITZ / GPS even without a data
  plan). A device left off / offline for days can drift past 45 s and stop
  verifying until its clock re-syncs.
- **Gate node clock — DECIDED: NTP.** Each node syncs to a time server on boot
  and periodically. NTP gives absolute **UTC** time; the timezone the campus is
  in does not matter, because the rolling counter is `floor(unixEpochMillis /
  15000)` — a count of 15 s slots since 1970-01-01 UTC, the same integer
  everywhere on Earth. The phone's "Automatic date & time" does the equivalent.
  So "follows the real timezone" is not needed — both sides just need the
  correct absolute instant. (Display strings like an event's timestamp can be
  localised to campus time later; the crypto never touches timezone.)
- Still open: widen the drift window? Add a "your clock looks wrong" warning in
  the app when `Date.now()` is implausible? Longer `TIME_STEP_MS` trades
  security for drift tolerance.

## Gate nodes — DECIDED: two nodes (entry + exit)

Two ESP32 receivers, identical firmware, configured per-unit with `direction`
(`in` / `out`) and `gateId`. No mesh, no TDOA, no triangulation.

- The phone emits the same chirp at either node; it never signals direction.
- **Secret map delivery — BUILT as PULL** (`server/`). The backend serves
  `GET /nodes/secrets` (bearer `NODE_TOKEN`) returning the full active
  `studentId → secret` map + a `revoked` list + a `revision` timestamp. Each
  node polls this on a timer and caches locally, so a node that reboots or
  briefly loses the LAN just re-fetches — no per-node addressing or retry queue
  the way a push would need. Push can be layered on later if near-instant
  revocation matters. Open: delta sync (`If-None-Match` on `revision`), poll
  interval, node-side cache format.
- `seed/students.json` is the fixture; `server` `npm run import-seed` loads it.

## Enrollment / provisioning

Enrollment is manual paste of `studentId` + `secret` in the app today.

- **Backend side BUILT** (`server/`): `POST /admin/students` (registrar issues a
  student + secret), `.../rotate` (new secret version), `.../revoke`. The
  registrar-facing tool/flow that calls these — and how the student then gets
  the secret onto their phone (one-time QR into the enroll screen?) — is still
  to design. Whatever it is, it needs connectivity **at enrollment only**;
  daily use stays offline.
- Secret handling on the device: `expo-secure-store` (OS keychain). Still to
  decide: re-enroll / device-lost path (revoke on the backend → nodes drop it
  on next pull → re-issue).

## Occupancy / headcount tracking (proposal requirement)

The proposal requires **live campus density / foot-traffic tracking** — a
running count of people currently inside, in the database, updated in real time.

- **Not a client responsibility.** The phone only emits the chirp. The count is
  written by the backend. **BUILT** (`server/`): `POST /ingest/events` appends
  an `access_events` row `(studentId, gateId, direction, eventTs, counter)` and
  moves `occupancy` (`in` +1 / `out` −1, floored at 0), idempotent on
  `gateId|studentId|counter`. `GET /occupancy` serves the live count +
  today's in/out.
- **Exit — DECIDED: a separate exit node.** Same firmware as the entry node,
  configured `direction = out`. On an accepted verify it POSTs an `out` event.
  Physical placement (which door is "in", which is "out") is an install-time
  concern; the phone stays dumb.
- **Reconciliation — still open.** Counts drift (tailgating, missed exits,
  reboots). Deferred: a nightly reset job + a manual-correction endpoint
  (append a correction event, never edit history).
- **Offline — still open.** If a node loses its backend link it must queue
  events locally and flush on reconnect (with the `counter` dedupe key making
  replays safe), or the count goes stale. The count is eventually-consistent by
  design.
- **Privacy:** `access_events` stores `studentId` only; no audio. Consistent
  with the no-raw-recording rule.

Client-side follow-up (small): after a successful emit the app could show
"you're checked in" once the node can echo an ack — optional, not required for
the count itself.

## Security review items

- **Replay:** a captured chirp is reusable within ~45 s. `PROTOCOL.md` tells the
  node to cache accepted `(studentId, counter)` pairs and reject reuse — confirm
  the firmware does this.
- **Shared-secret exposure:** one leaked secret = one impersonatable student
  until revoked. No account lockout, no rate limit at the gate yet.
- **Debug line** (`window <counter>`) is visible on the gate-pass screen for the
  pilot. Remove for a public release.
- Secrets are committed in `seed/students.json` on purpose (runs out of the
  box). Production must generate fresh secrets and keep the roster out of VCS.

## Audio / hardware

- Default FSK band is 17–19 kHz. Real phone speakers and the ESP32 mic roll off
  differently — the four frequencies, `symbolMs`, and amplitude in
  `DEFAULT_CHIRP` must be tuned against the actual pilot hardware, then
  `PROTOCOL.md` updated in lockstep.
- Playback path uses a cache WAV file. Confirm `expo-file-system` cache writes
  survive on the target OS versions and that `cleanupChirps()` keeps the cache
  bounded over a long session.
- iOS silent switch: handled via `setAudioModeAsync({ playsInSilentMode: true })`
  — verify on a real device.
- Very loud ambient noise at a busy gate may swamp an 18 kHz tone. Measure SNR
  at the real gate; consider error-correction bits if decode rate is poor.

## UI / layout

- Layout is functional, not final — a proper pass is planned. The 6-digit code
  card is the anchor; keep it the visual priority.
- Accessibility: code has an `accessibilityLabel`; check contrast and font
  scaling once the redesign lands.

---

## Decided

- **Nodes:** two — one entry, one exit — identical firmware, per-unit
  `direction` + `gateId` config. No mesh/TDOA.
- **Exit mechanism:** the dedicated exit node emits `direction = out` (occupancy
  −1). Phone never signals direction.
- **Secret map on the node:** PULL from the backend (`GET /nodes/secrets`,
  bearer `NODE_TOKEN`), node caches locally for offline resilience. Built in
  `server/`. (Delta sync / poll interval still to spec; push can be added later
  if instant revocation is needed.)
- **Backend:** Node + Express + SQLite (`node:sqlite`), lives in `server/` of
  this repo. Core API built: admin/provisioning, node secret pull, event
  ingest, occupancy read. Deferred: dashboard UI, nightly reset, manual
  correction.
- **Node time:** NTP (absolute UTC). Timezone is irrelevant to the rolling-code
  math; only the correct absolute instant matters.
- **Hardware:** not on hand yet — near-term work is software only (see
  `README.md` next-steps); FSK frequency tuning is deferred until pilot
  hardware exists.
