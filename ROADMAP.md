# SonicAccess Phase 1 — roadmap

Phase 1 = the ultrasonic student authenticator for touchless gate entry, plus
the pieces needed to run and prove it. Design decisions and open questions live
in [`CONSIDERATIONS.md`](CONSIDERATIONS.md).

## Done

- **Client core** — `tokenGenerator` (HOTP/RFC 4226 rolling 6-digit code, **30 s
  window**, 48-bit FSK payload + CRC-8), `audioSynthesizer` (binary FSK
  ultrasonic WAV), `authService` (on-device enrollment), `GatePassScreen`
  (authenticator-style live code + emit).
- **Reference decoder + round-trip test** — `scripts/fsk-decoder.mjs`
  (`decodeWav`, mirrors `src/PROTOCOL.md`), `scripts/roundtrip-test.mjs`
  (`npm run test:audio`) under offset / noise / low-amplitude / tamper.
- **Backend** (`server/`) — Node + Express + `node:sqlite`. Registry +
  provisioning (`/admin/students` with auto-generated secret, rotate, revoke,
  `enroll-code` → base64 + QR), node secret **pull** (`/nodes/secrets` +
  ETag/304), event **ingest** (`/ingest/events`, occupancy ±1, idempotent,
  floored), occupancy read, operator adjust/reset (`occupancy_adjustments`
  audit), nightly-reset script, 16 API tests, deploy notes.
- **Shared console** (`GET /`) — one static page, three tabs: Overview·Security,
  Enrollment·Registrar (issue a student → show the QR/code), Discipline·Guidance
  (placeholder for SO5).
- **Gate node simulator** — `scripts/gate-sim.mjs` (`npm run gate-sim`): the
  ESP32's job on a laptop. WAV → decode → verify → replay cache → ingest.
- **End-to-end test** — `scripts/e2e-test.mjs` (`npm run test:e2e`): boots the
  backend, provisions, chirp → decode → verify → ingest, asserts the whole
  pipeline. In root `npm test`.

## Next: C — client polish (no hardware needed)

### C1. Robustness pair — DONE
- `config.SHOW_DEBUG` (`__DEV__`) gates the `window <counter>` line; off in a
  release build.
- `services/clock` — `checkClock` / `clockWarning`; `GatePassScreen` shows a
  banner when the device year is out of 2025–2100 or the clock is set before the
  build. (A network/ack-based drift check comes later with the node ack.)

### C2. Login + provisioning (model A) — DONE
- `services/vault.ts` — secret sealed with `scrypt` + XChaCha20-Poly1305 under
  the unlock password (`@noble/hashes` + `@noble/ciphers`).
- `services/enrollmentCode.ts` — parse the registrar QR / pasted code
  (`{ t:"sonicaccess/v1", sid, sec, nm? }`, raw or base64).
- `authService.ts` — `enroll` / `getEnrollment` / `unlock` (attempts →
  `WrongPasswordError` → self-wipe `LockedOut`) / `clearEnrollment`.
- `screens/EnrollScreen` (QR via `expo-camera` + manual fallback + set
  password), `UnlockScreen` (password + re-enroll), `GatePassScreen` now
  props-only; `App.tsx` routes loading → enroll → locked → unlocked and re-locks
  on background.
- `npm run test:enroll` green.
### C2b. Login hardening — mostly DONE
- **Biometric unlock** — opt-in at enrollment **or** via a toggle on
  `GatePassScreen` (`enableBiometric` / `disableBiometric`); `UnlockScreen`
  auto-prompts on mount + has a button. Secret copy behind `expo-secure-store`
  `requireAuthentication`; password fallback on cancel / unavailable. (Untested
  on a physical device.)
- **Timed session** — `App` re-locks only after `SESSION_TTL_MS` (3 min) of
  background, not on every app switch.
- [ ] Signed / one-time enrollment payload — still open (needs a backend signer).

### C4. UI redesign (QCU palette) — DONE
- `src/theme.ts` — Quezon City University palette (blue `#0B3C8C` / white / red
  `#C8102E` / gold `#F2B705`) + spacing / radius / type tokens.
- `src/components/ui.tsx` — `Screen`, `Brand`, `Card`, `Button`, `Field`,
  `Banner`, `LinkButton`.
- All three screens + `App.tsx` restyled (light theme, blue brand, gold code +
  progress, red for expiry / errors). `server/public/index.html` dashboard
  restyled to match.
- Follow-up: swap the default Expo app icon / splash for QCU branding; on-device
  polish pass (font scaling, screen-reader labels beyond the code).

### C3. EAS build config — DONE
- `eas.json` — `development` / `preview` / `production` profiles.
- `app.config.js` — blocks the Android `INTERNET` permission for every profile
  except `development` (which sets `SONIC_ALLOW_INTERNET=1` for Metro). Verified
  via `expo config`: release config carries
  `blockedPermissions: ['android.permission.INTERNET']`.
- `app.json` — `package` / `bundleIdentifier` `ph.edu.qcu.sonicaccess`,
  versionCode / buildNumber.
- Build + offline-verification steps in `RUNNING.md` §8.
- Left: run `eas init` (writes `extra.eas.projectId`) and the first cloud build
  — needs an Expo account + connectivity.

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
