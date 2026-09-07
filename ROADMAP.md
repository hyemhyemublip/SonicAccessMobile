# SonicAccess Phase 1 — roadmap

Phase 1 = the ultrasonic student authenticator for touchless gate entry, plus
the pieces needed to run and prove it. Design decisions and open questions live
in [`CONSIDERATIONS.md`](CONSIDERATIONS.md).

## Done

- **Client core** — `tokenGenerator` (HOTP/RFC 4226 rolling 6-digit code, 48-bit
  FSK payload + CRC-8), `audioSynthesizer` (binary FSK ultrasonic WAV),
  `authService` (on-device enrollment), `GatePassScreen` (authenticator-style
  live code + emit).
- **Reference decoder + round-trip test** — `scripts/fsk-decoder.mjs`
  (`decodeWav`, mirrors `src/PROTOCOL.md`), `scripts/roundtrip-test.mjs`
  (`npm run test:audio`) under offset / noise / low-amplitude / tamper.
- **Backend** (`server/`) — Node + Express + `node:sqlite`. Registry +
  provisioning (`/admin/students`, rotate, revoke), node secret **pull**
  (`/nodes/secrets` + ETag/304), event **ingest** (`/ingest/events`, occupancy
  ±1, idempotent, floored), occupancy read, operator adjust/reset
  (`occupancy_adjustments` audit), nightly-reset script, static dashboard at
  `/`, 13 API tests, deploy notes.
- **Gate node simulator** — `scripts/gate-sim.mjs` (`npm run gate-sim`): the
  ESP32's job on a laptop. WAV → decode → verify → replay cache → ingest.
- **End-to-end test** — `scripts/e2e-test.mjs` (`npm run test:e2e`): boots the
  backend, provisions, chirp → decode → verify → ingest, asserts the whole
  pipeline. In root `npm test`.

## Next: C — client polish (no hardware needed)

### C1. Robustness pair (small, do first)
- Debug line (`window <counter> · code …`) behind a dev flag; off in release.
- Clock-sanity warning: if `Date.now()` is implausible (or drift shows up via a
  node ack later), tell the student to set date & time to automatic — the
  rolling code breaks past ~±15 s of drift.

### C2. Login + provisioning — **model A** (see `CONSIDERATIONS.md`)
- Student logs in with **student number + short alphanumeric password**. The
  password decrypts an `Argon2id`-wrapped on-device secret; it never reaches the
  backend.
- One-time enrollment via **QR / enrollment code** from the registrar (uses the
  built `/admin/students`); the 32-char secret is never typed.
- Emit: password **or** biometric (`expo-local-authentication`) unlock, key
  cached in memory for N minutes.
- Wrong password → AEAD failure + attempt lockout; forgot password → re-enroll
  (old secret `revoke`d).
- Needs: `expo-camera` (scan), an Argon2id impl, `expo-local-authentication`
  (optional biometric). No backend change for the password itself.

### C3. EAS build config
- `eas.json` + build profiles; strip Android `INTERNET` permission in `app.json`
  for provably-offline builds.
- Verify the standalone build runs fully offline (enroll once online, then
  airplane mode).

### C4. Layout redesign
- Full visual pass, iterating on a real device. Keep the 6-digit code card as
  the anchor. Accessibility: contrast, font scaling, screen-reader.

## Later: E — gate node firmware (needs hardware)

Port `decodeWav` + `verifyToken` to the ESP32: mic capture, FFT, preamble lock,
per-symbol tone decision, CRC, HOTP re-derive, replay cache, relay output, NTP
clock, `/nodes/secrets` pull + local cache, offline event queue + flush.
Then tune the FSK band (`f0`/`f1`/`fPreamble`/`symbolMs`) to real hardware and
update `src/PROTOCOL.md` + `DEFAULT_CHIRP` in lockstep.

## Backend follow-ups (not blocking)

Cron/timer wiring for the nightly reset on the deploy box; node-side offline
event queue semantics; delta-sync body on `/nodes/secrets` (only `If-None-Match`
/ 304 is done).

## Future modifications (design notes only — `CONSIDERATIONS.md`)

- Hardware **loaner fob** for students without their phone.
- Multiple active credentials per student (phone + fob).
