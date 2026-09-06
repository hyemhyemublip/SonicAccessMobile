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
- **Secret map delivery — DECIDED: local admin endpoint.** Each node exposes a
  small admin API on the campus LAN; the backend (or an operator tool) pushes
  the current `studentId → secret` map and revocations to it. Node caches the
  map locally so it keeps verifying if the endpoint is unreachable. Open: auth
  on that endpoint, push vs pull, full-map vs delta.
- `seed/students.json` is the fixture shape for that map during development.

## Enrollment / provisioning

Enrollment is manual paste of `studentId` + `secret` today.

- A registrar-issued provisioning flow (scan a one-time QR, or a call to a
  backend) would need connectivity **at enrollment only** — offline after. Keep
  the offline guarantee scoped to normal daily use, not first setup.
- Secret handling: it currently lives in `expo-secure-store` (OS keychain).
  Confirm that's acceptable, and decide on a re-enroll / device-lost path
  (revoke the secret on the node, re-issue).

## Occupancy / headcount tracking (proposal requirement)

The proposal requires **live campus density / foot-traffic tracking** — a
running count of people currently inside, in the database, updated in real time.

- **Not a client responsibility.** The phone only emits the chirp. The count is
  written by the **gate node** (or the backend it posts to) on each accepted
  verify: entry event → `occupancy += 1`, plus an append-only log row
  `(studentId, timestamp, direction=in, gateId)`.
- **Exit — DECIDED: a separate exit node.** Same firmware as the entry node,
  configured `direction = out`. On an accepted verify it emits an `out` event →
  `occupancy -= 1`. Physical placement (which door is "in", which is "out") is
  an install-time concern; the phone stays dumb.
- **Reconciliation:** counts drift (tailgating, missed exits, node reboot).
  Plan a periodic reset (e.g. nightly to 0) and/or a manual correction path.
- **Offline:** if the node loses its backend link, it must queue entry/exit
  events locally and flush on reconnect, or the count goes stale. Fits the
  "gate works offline" goal — the count is eventually-consistent.
- **Privacy:** store the aggregate count and per-event rows with `studentId`
  only; no audio, consistent with the no-raw-recording rule.

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
- **Secret map on the node:** pushed over a local admin endpoint on the campus
  LAN; node caches locally for offline resilience. (Auth / push-vs-pull /
  delta-vs-full still to spec.)
- **Node time:** NTP (absolute UTC). Timezone is irrelevant to the rolling-code
  math; only the correct absolute instant matters.
- **Hardware:** not on hand yet — near-term work is software only (see
  `README.md` next-steps); FSK frequency tuning is deferred until pilot
  hardware exists.
