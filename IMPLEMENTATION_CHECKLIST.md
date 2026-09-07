# Implementation checklist

Where the build stands against the SonicAccess proposal (Phase 1 = the
ultrasonic student authenticator + what's needed to run and prove it), and what
we added that the proposal does not call for.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · `[-]` out of Phase 1

---

## 1. Proposal — Phase 1 scope

### Specific Objective 1 — dynamic rolling acoustic chirp handshaking

- [x] **Mobile client generates a dynamic, time-based rolling code**
  `src/services/tokenGenerator.ts` — HOTP / RFC 4226 (HMAC-SHA1, dynamic
  truncation), 30 s window, 6-digit code.
- [x] **Modulated to an inaudible FSK chirp**
  `src/utils/audioSynthesizer.ts` — binary FSK (17 / 18 / 19 kHz), preamble +
  start marker + 48-bit payload, 16-bit PCM WAV, played via `expo-audio`.
- [x] **Touchless entry UI on the phone**
  `src/screens/GatePassScreen.tsx` — authenticator-style live code + countdown +
  "Emit gate pass".
- [~] **Edge receiver decodes the chirp**
  Reference decoder `scripts/fsk-decoder.mjs` + gate simulator
  `scripts/gate-sim.mjs` + frozen wire spec `src/PROTOCOL.md`.
  **ESP32 firmware not built — no hardware yet** (see ROADMAP §E).
- [x] **Eliminates static token sharing**
  No static card/QR; a captured chirp is only replayable for ~30–45 s, and the
  gate + simulator cache `(gateId, studentId, counter)` to reject reuse.
- [x] **Touchless campus density tracking**
  `server/` — entry `+1` / exit `−1`, `GET /occupancy`, live dashboard at `/`.
- [ ] **Reduce entry processing time** — not measured; needs a field test /
  timing harness (ROADMAP §D).

### Specific Objective 3 — edge FFT firmware on low-cost nodes

- [~] **Decode dynamic ultrasonic tokens** — algorithm proven in software
  (`decodeWav`: preamble lock, per-symbol Goertzel, CRC, HOTP verify); not on an
  ESP32.
- [ ] **Detect high-stress / distress acoustic signatures without recording raw
  audio** — not started (belongs with the firmware + Phase 3 work).

### Web stack (proposal: "React, Node.js, Express")

- [x] **Node.js + Express backend** — `server/` (registry, provisioning, secret
  pull, event ingest, occupancy).
- [~] **Console** — static HTML page at `/`, a **shared-device console with
  three tabs**: Overview·Security, Enrollment·Registrar, Discipline·Guidance.
  Not a React app.
- [~] **Database** — SQLite (`node:sqlite`); the proposal does not name a DB.

### Users served (one shared console at the gate desk)

- [x] **Students** — the mobile app.
- [~] **Gate security personnel** — Overview tab: live occupancy, node liveness,
  recent events, manual count correction. No vehicle-queue view.
- [~] **Registrar** — Enrollment tab: create/update a student and get the
  enrollment **code + QR** on screen for the student to scan. Roster with
  rotate / revoke.
- [ ] **Prefect of Discipline / Guidance** — Discipline tab is a placeholder
  (live gate activity only); one-touch violation logging (Specific Objective 5)
  not built.

### Out of Phase 1 (in the proposal, later phases)

- [-] ALPR / computer vision (YOLOv8 + EasyOCR) — Specific Objective 2.
- [-] Acoustic mesh + TDOA threat triangulation — Specific Objective 4.
- [-] One-touch violation logging workflow — Specific Objective 5.

---

## 2. Built, but not called for in the proposal

Added because Phase 1 could not be built, run, or trusted without them.

### Protocol / crypto specifics
- [x] **Chose HOTP / RFC 4226 + RFC 6238** as the concrete scheme. The proposal
  only says "operating similarly to rolling cryptographic authenticators".
- [x] **48-bit payload layout** `studentId(20) | rollingCode(20) | CRC-8(8)`,
  MSB-first, documented in `src/PROTOCOL.md`.
- [x] **CRC-8 integrity field** — the proposal says "encrypted tokens" but names
  no integrity check.
- [x] **6-digit decimal code** (Google-Authenticator style) instead of a raw
  binary value, for a legible on-screen number.
- [x] **Frozen wire contract** `src/PROTOCOL.md` with a "provisional" marker on
  the FSK frequencies pending hardware tuning.

### Tooling (no hardware needed)
- [x] `scripts/fsk-decoder.mjs` — software reference decoder (the spec the
  firmware must match).
- [x] `scripts/gate-sim.mjs` — gate-node simulator: decode → verify → replay
  cache → ingest. Lets the whole flow run on a laptop.
- [x] `scripts/token-selftest.mjs` — RFC 4226 test vectors + CRC-8 check value.
- [x] `scripts/roundtrip-test.mjs` — modulator ↔ decoder conformance under
  offset / noise / low amplitude / tamper.
- [x] `scripts/e2e-test.mjs` — full pipeline (backend + client + decoder) in one
  run; part of `npm test`.
- [x] `scripts/seed-students.mjs` + `seed/students.json` — sample roster +
  generator.

### Backend design (proposal leaves these unspecified)
- [x] **Pull-based secret distribution** — nodes `GET /nodes/secrets`, cache
  locally; `ETag` / `If-None-Match` → `304`.
- [x] **Two-node model** — one entry, one exit, identical firmware, per-unit
  `direction` + `gateId`. Proposal implies entry only.
- [x] **Append-only `access_events`** — DB triggers block UPDATE/DELETE.
- [x] **`occupancy_adjustments`** audit table + `POST /occupancy/adjust` /
  `/reset` + `scripts/reset-occupancy.mjs` for nightly cron — reconciliation
  mechanics the proposal does not describe.
- [x] **Bearer-token role auth** (`admin` / `node` / `read`), fail-closed.
- [x] **Versioned secrets** with rotate / revoke lifecycle.
- [x] **`import-seed`**, `LOG_REQUESTS` toggle, 13-case API test suite, deploy
  notes (systemd unit, SQLite backup).

### Login / enrollment
- [x] **Password login (model A)** — student number + password; the secret is
  sealed on-device with `scrypt` + XChaCha20-Poly1305 and never leaves it in the
  clear. `src/services/vault.ts`, `authService.ts`, `EnrollScreen`,
  `UnlockScreen`; `App.tsx` routes and re-locks on background.
- [x] **QR enrollment (client)** — `expo-camera` scan of the registrar payload
  (`enrollmentCode.ts`), manual-paste fallback; base64 is the canonical
  paste-safe code, parser repairs smart quotes / whitespace.
- [x] **Registrar enrollment-code generator** — `GET /admin/students/:id/
  enroll-code` (base64 + PNG QR data URL); driven from the console's Enrollment
  tab, or `npm run enroll-code` from the CLI. `POST /admin/students` now
  auto-generates the secret if omitted.
- [x] **Attempt lockout** — vault self-wipes after 10 wrong passwords.
- [x] **Biometric unlock** — opt-in at enrollment or via a toggle on the gate
  screen; Face ID / fingerprint returns the secret via `expo-secure-store`
  `requireAuthentication`, password always a fallback. (Not yet tested on a
  device.)
- [x] **Timed session** — re-locks after `SESSION_TTL_MS` (3 min) of background,
  not every app switch.
- [ ] Signed / one-time enrollment payload (needs a backend signer).

### UI
- [x] **QCU-themed redesign** — `src/theme.ts` palette (blue / white / red /
  gold) + `src/components/ui.tsx` kit; all screens + the `server/` dashboard
  restyled. Proposal names no visual identity; this is the QCU one.
- [ ] QCU app icon / splash (still the Expo default).

### Client robustness
- [x] **Device-clock sanity warning** `src/services/clock.ts` — the rolling code
  is time-based and there is no network reference offline.
- [x] **`SHOW_DEBUG` flag** (`src/config.ts`) — hides the `window <counter>`
  diagnostic in release builds.
- [x] **Local `verifyToken` self-check** before every emit.
- [x] **Provably-offline build** — `eas.json` profiles + `app.config.js` blocks
  the Android `INTERNET` permission for `preview` / `production` (only
  `development` keeps it, for Metro). `app.json` has real package /
  bundle IDs. Left: `eas init` + first cloud build (needs an Expo account).

### Documentation added
- [x] `README.md`, `RUNNING.md` (Expo Go run guide), `BACKEND.md`,
  `CONSIDERATIONS.md` (open decisions), `ROADMAP.md`, `src/PROTOCOL.md`, and a
  README per folder.

### Design notes captured for later (not built)
- [ ] **Hardware loaner fob** for students without their phone.
- [ ] **Multiple active credentials per student** (phone + fob).

---

## 3. Deviations / clarifications vs proposal wording

- **"Encrypted" tokens** → the code is a **truncated HMAC-SHA1** (a keyed
  message authentication code), not ciphertext. It authenticates, it is not
  decryptable. Functionally what the proposal intends ("rolling cryptographic
  authenticator").
- **"Inaudible / ultrasonic"** → the default band is **17–19 kHz**, near the top
  of human hearing but not strictly > 20 kHz ultrasound. Chosen for phone-
  speaker and MEMS-mic response; to be retuned on pilot hardware.
- **Dashboard** → **static HTML**, not React. Node.js + Express backend matches
  the proposal; the front-end framework does not.
- **Database** → **SQLite**, chosen for a single-campus offline-friendly pilot;
  the proposal names none.
- **Offline-first** → the running app and gate make **no network calls**; the
  backend is only touched by the gate node and dashboards. The proposal's
  "resilient local mesh" goal is met on the client/gate side; the mesh itself is
  Phase 3.
