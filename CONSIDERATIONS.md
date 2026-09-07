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
- **Clock warning — BUILT.** `src/services/clock.ts` (`checkClock` /
  `clockWarning`); `GatePassScreen` shows a banner when the device year is
  outside 2025–2100 or the clock is set before `config.BUILD_EPOCH_MS`. It is
  best-effort (no network reference); a tighter drift check waits for the node
  ack. Still open: widen the gate drift window? Longer `TIME_STEP_MS`? Both
  trade security for tolerance.

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

## Enrollment / provisioning + app login

Manual paste of `studentId` + `secret` today. Target: student logs in with
**student number + a short alphanumeric password**, never types the 32-char
secret.

**Backend side BUILT** (`server/`): `POST /admin/students` (registrar issues a
student + secret), `.../rotate`, `.../revoke`. Needs connectivity **at
enrollment only**; daily use stays offline.

### The constraint

You can't have all three of {no secret on the phone, works offline, short
password} — pick two:

| | secret on phone | offline | short password |
| --- | --- | --- | --- |
| **A. password unlocks an encrypted on-device secret** | yes (ciphertext) | ✅ | ✅ |
| B. app fetches the code from the backend each time | no | ✗ (breaks the Phase 1 goal) | ✅ |
| C. secret = KDF(password), nothing else stored | no | ✅ | weak — one recorded chirp + known student number lets a weak password be brute-forced offline |

### DECIDED: model A

- The 160-bit secret stays on the device but **encrypted at rest** with a key
  from `Argon2id(password, per-install random salt, high cost)`.
- **Enrollment** (one-time, online): app receives the secret via a QR / one-time
  enrollment code from the registrar, immediately encrypts it with the
  password-derived key, stores `{ studentId, salt, nonce, ciphertext }` in
  `expo-secure-store`, discards the plaintext secret and the password.
- **Emit**: prompt password **or** device biometric
  (`expo-local-authentication`) → derive key → decrypt → HOTP → chirp → zero the
  secret from memory. Cache the key in memory for N minutes / until backgrounded
  so it isn't typed on every entry.
- **Wrong password**: AEAD tag fails → "wrong password"; count attempts; wipe
  after ~10.
- **Forgot password / device lost**: re-enroll from the registrar (new secret
  issued, old `revoke`d → nodes drop it on next `/nodes/secrets` pull).
- **Backend impact: none for the password** — it is a client-only wrapping key,
  the backend never sees it. The backend only needs to authorize the one-time
  secret handover (QR token / enrollment code).
- **Security note**: the password only matters if the phone is stolen *and* the
  ciphertext is extracted from `expo-secure-store` (hard on modern iOS/Android).
  Argon2id slows offline guessing; require 8+ alphanumeric. An attacker without
  the phone gains nothing from the password. Proportionate for a campus gate.
- Still open: password policy (length/charset), attempt-lockout count, key
  cache TTL, whether biometric is required or optional, KDF cost calibration on
  low-end devices.

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
- **Reconciliation — BUILT.** `POST /occupancy/adjust {delta}` and
  `POST /occupancy/reset {to}` (admin), plus `npm run reset-occupancy` for
  cron. Every change is logged to `occupancy_adjustments` (`prev_count`,
  `new_count`, `reason`, `role`); `access_events` stays pure gate traffic. Still
  open: the actual cron/timer wiring on the deploy box, and how often to reset.
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

## Hardware fob (loaner) — future modification

For students who leave their phone behind: a keychain fob that emits the same
chirp. Feasible — nothing on the gate or backend has to change (a chirp is a
chirp). Open questions from that discussion, answered:

### How does the fob connect to the database?

It doesn't — and neither does the phone. Runtime data only ever flows
`fob → (sound) → gate node → (HTTP) → backend`. The fob is offline for life.
The only fob↔system contact is at a **desk cradle** (USB / NFC / pogo pins),
used for two things:

- **Provisioning**: burn a secret + a fob id, set the RTC. The registrar tool
  driving the cradle registers the credential by calling the existing
  `POST /admin/students` (or a fob-specific admin route) — that write reaches
  the DB, the fob never does.
- **Resync**: bump the RTC (and top up the cell) whenever the fob is docked.

### How does the fob generate the 6-digit number?

Same as the app — the number is **not** downloaded from anywhere and the app
does not invent it. Both devices *compute* it:

```
code = HOTP(secret, floor(unixMillis / 15000)) mod 1_000_000
```

Inputs: the fixed **secret** (issued once at provisioning, stored on the device)
and a **clock**. The backend/gate recompute the same value because they hold the
same secret and the same time. So the fob needs exactly: (a) the secret burned
in, (b) an RTC, (c) `HOTP` + FSK code on button press. Its fob id goes in the
payload so the gate knows whose code it is.

- **Separate secret per device** (recommended): phone = secret A, fob = secret
  B, both mapped to the student. Revoking one leaves the other working, and you
  never copy the phone's keychain secret out. Needs the backend to allow more
  than one active credential per student (drop the "one active secret per
  student" unique index → `/nodes/secrets` returns a list per student and the
  gate tries each), **or** give fobs their own id range.

### Does it need the same frequency range as the phone?

Yes — not because fob and phone talk to each other (they never do), but because
the **gate node** decodes everything with one fixed FFT config. The fob must
emit the same `f0` / `f1` / `fPreamble` / `symbolMs` as `DEFAULT_CHIRP` /
`PROTOCOL.md §4`. Practical consequence: when the band is finally tuned to
hardware, tune it for the **weakest emitter** (likely the tiny fob transducer)
and let the phone follow — one shared config, still marked provisional until
hardware exists.

### Simplest shippable version

A **pool of loaner fobs** at the gate desk, not one per student:

- Reserve an id range (e.g. `900000–900999`); each fob is its own credential
  row with its own secret.
- Desk logs fob → student on hand-out ("student 231805 took fob #12"),
  clears it on return.
- Gate treats it as a normal credential — **zero protocol change**, small
  backend change (id range + assignment log).
- Cradle at the desk keeps every fob's RTC synced and cell charged.

### Other fob notes

- **Secret extraction:** enable MCU flash readout protection (nRF52 APPROTECT /
  ESP32 flash encryption / STM32 RDP). Worst case = one cloned credential until
  revoked — same blast radius as a leaked phone secret.
- **Loss/theft:** revoke on the backend → nodes drop it on next `/nodes/secrets`
  pull. Already built.
- **Transducer:** piezo resonates well at ~18–20 kHz but is narrowband; FSK
  needs `f0` and `f1` both radiated at usable level, so a small mylar speaker is
  safer. This is the main hardware risk — measure SPL at both tones at the
  gate-mic distance.
- **BOM** ≈ $3–8/fob at small volume (MCU + DS3231 RTC + speaker + CR2032 + PCB
  + case), plus the cradle and the desk process.

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
  `server/`, with `ETag`/`If-None-Match` → `304` so an unchanged map is a cheap
  no-op. (Poll interval still to spec; push can be added later if instant
  revocation is needed.)
- **Backend:** Node + Express + SQLite (`node:sqlite`), in `server/`. Built:
  admin/provisioning, node secret pull (+304), event ingest, occupancy read,
  operator adjust/reset (`occupancy_adjustments` audit), nightly-reset script,
  static dashboard at `/`, 13 API tests, deploy notes. Deferred: cron wiring,
  node offline queue, delta-sync body.
- **Node time:** NTP (absolute UTC). Timezone is irrelevant to the rolling-code
  math; only the correct absolute instant matters.
- **App login:** student number + short alphanumeric password (model A). The
  password locally decrypts an `Argon2id`-wrapped on-device secret; it never
  reaches the backend. The 32-char secret is issued once via QR / enrollment
  code and never typed by the student. See "Enrollment / provisioning + app
  login".
- **Hardware:** not on hand yet — near-term work is software only (see
  `ROADMAP.md`); FSK frequency tuning is deferred until pilot hardware exists.
