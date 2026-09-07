# SonicAccessMobile

Phase 1 of **SonicAccess** — the student-side authenticator for touchless campus
gate entry.

The phone replaces an RFID card / QR code. On demand it derives a short-lived
rolling code from a per-student shared secret and broadcasts it as an inaudible
FSK ultrasonic chirp. An ESP32 gate node hears the chirp, runs an FFT to recover
the code, verifies it, and opens the gate. No raw audio is ever recorded.

This repo is **only the mobile client** (Expo / React Native). The gate-node
firmware, the registrar backend, and the acoustic-mesh threat triangulation
(Phases 2–3) live elsewhere.

## Deployment scope for this phase

**Two gate nodes — one entry, one exit.** Both are plain ESP32 receivers running
the same firmware; they differ only by a configured `direction` (`in` / `out`)
and `gateId`. Each answers "is this chirp a valid current code for an enrolled
student?" — decode + verify + open — and writes an access event (entry `+1` /
exit `−1` to the live occupancy count). So:

- no mesh network, no TDOA, no triangulation (that is Phase 3);
- no "which gate" logic on the phone — it emits the same chirp at either node;
- each node holds the whole `studentId → secret` map, refreshed via a local
  admin endpoint, and keeps an NTP-synced clock for the rolling-window check.

Everything in `src/PROTOCOL.md` is written for that two-node case.

**Offline:** the running app makes no network calls — token derivation, chirp
synthesis, playback and credential storage are all local. It works air-gapped at
the gate, given a standalone build (not Expo Go) and a phone clock kept roughly
accurate (the code is time-windowed). Details and other pre-production decisions
are in [CONSIDERATIONS.md](CONSIDERATIONS.md).

## Running the app

See **[RUNNING.md](RUNNING.md)** — installing Expo Go, starting the dev server,
and loading the app on a phone (plus the web preview).

## Stack

- Expo SDK 57, React Native 0.86, React 19, TypeScript
- `expo-audio` — chirp playback
- `expo-file-system` — writes the generated WAV to cache
- `expo-secure-store` — holds the student's id + secret in the OS keychain
- `js-sha1` — HMAC-SHA1 for the HOTP rolling code

## Layout

| Path              | What                                                        |
| ----------------- | ---------------------------------------------------------- |
| `App.tsx`         | Mounts `GatePassScreen`.                                   |
| `RUNNING.md`      | Step-by-step run guide (Expo Go, dev server, on-device).   |
| `BACKEND.md`      | Backend design overview (data model, flows, security).     |
| `ROADMAP.md`      | Phase 1 status and what's next.                            |
| `IMPLEMENTATION_CHECKLIST.md` | Build vs proposal scope; what we added beyond it. |
| `CONSIDERATIONS.md` | Open decisions before production: offline, clock drift, provisioning, security, audio tuning. |
| `src/`            | All application code — see `src/README.md`.                |
| `src/PROTOCOL.md` | The wire contract shared with the gate-node firmware.      |
| `scripts/`        | Node self-tests, FSK reference decoder, roster seed generator. |
| `server/`         | Phase 1 backend — registry, secret pull, event ingest, occupancy (own README). |
| `seed/`           | Sample student roster (registrar / gate fixture).          |
| `assets/`         | App icons and splash.                                      |

## Common commands

```bash
npm start            # expo dev server (use a physical device — needs a speaker)
npm test             # typecheck + token self-test + FSK round-trip + full e2e
npm run typecheck    # tsc --noEmit
npm run selftest     # crypto / token self-test (RFC 4226 vectors)
npm run test:audio   # token -> WAV -> reference decoder -> verify (noise/offset)
npm run test:e2e     # backend + client + decoder: chirp -> ingest -> occupancy
npm run decode -- rec.wav [secret]   # decode a WAV with the reference decoder
npm run gate-sim -- --gate-id g --direction in rec.wav   # simulate a gate node
npm run seed         # (re)generate seed/students.json
```

End-to-end with no hardware: run `server/` (backend), then `npm run gate-sim`
pointed at it, then feed it a WAV recorded from the app — occupancy moves. See
`scripts/README.md` and `BACKEND.md`.

## How it works (one paragraph)

`tokenGenerator` builds a 48-bit payload = `studentId(20) + rollingCode(20) +
CRC-8(8)`, where `rollingCode = HOTP(secret, floor(now / 15s)) mod 1_000_000` — a
6-digit rolling decimal, same idea as Google Authenticator.
`audioSynthesizer` modulates those bits with binary FSK (bit 0 → 18 kHz, bit 1 →
19 kHz, 17 kHz preamble), renders a mono 16-bit WAV, and `GatePassScreen` plays
it. The gate re-derives the expected `rollingCode` for the current 15-second
window (± 1 window of clock drift) and compares. Full spec: `src/PROTOCOL.md`.
