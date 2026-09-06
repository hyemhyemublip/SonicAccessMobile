# SonicAccess Phase 1 — Acoustic Token Protocol

This document is the contract between the mobile client (this repo) and the
ESP32 gate node firmware. Both sides must implement it identically. Changing any
constant here is a breaking change for deployed gates.

**Scope: two gate nodes — one entry, one exit.** Both run identical firmware and
differ only by configuration: `direction` (`in` / `out`) and `gateId`. No mesh,
no TDOA, no triangulation (that is Phase 3). Each node holds the full
`studentId → secret` map, refreshed over a **local admin endpoint**, and keeps
an **NTP-synced clock** (absolute UTC time — timezone does not affect the
rolling-window math, which is based on Unix epoch milliseconds).

## 1. Overview

The phone is the authenticator. On demand it:

1. derives a short-lived rolling code from a per-student shared secret,
2. packs `studentId + rollingCode + checksum` into a 48-bit payload,
3. modulates the payload into an inaudible FSK chirp and plays it through the
   speaker.

The gate node continuously runs an FFT on its microphone input, detects the
preamble tone, samples one FFT frame per symbol, recovers the 48 bits, then
re-derives the expected rolling code for the current time window (± drift) and
compares. Raw audio is never stored.

On an accepted verify the node records an access event to the campus database —
`(studentId, timestamp, direction, gateId)` — and updates the live occupancy
count: the **entry node** (`direction = in`) increments it, the **exit node**
(`direction = out`) decrements it. The two nodes are physically separate; the
phone emits the same chirp at either one and never says which. Event recording
is out of scope for this acoustic contract, but the `studentId` it delivers is
the key input. See `CONSIDERATIONS.md` → "Occupancy / headcount tracking".

## 2. Token derivation (`src/services/tokenGenerator.ts`)

| Parameter          | Value                                   |
| ------------------ | --------------------------------------- |
| Algorithm          | HOTP (RFC 4226) dynamic truncation      |
| HMAC               | HMAC-SHA1                               |
| Key                | the shared secret **as raw UTF-8 bytes**|
| Counter            | `floor(unixMillis / TIME_STEP_MS)`      |
| `TIME_STEP_MS`     | `15000` (15 s rolling window)           |
| Gate drift window  | ± 1 step (accept previous/next window)  |

`rollingCode = HOTP(secret, counter) mod 1 000 000`  (6-digit decimal, RFC 6238 style)

The gate must keep NTP-synced time (or sync from the campus server) so its
counter matches the phone's within the drift window.

## 3. Payload layout (48 bits, MSB first)

| Field        | Bits | Range         | Notes                                    |
| ------------ | ---- | ------------- | ---------------------------------------- |
| `studentId`  | 20   | 0..1_048_575  | assigned by registrar                    |
| `rollingCode`| 20   | 0..999_999    | 6-digit HOTP truncation `mod 1_000_000`, see §2 |
| `checksum`   | 8    | 0..255        | CRC-8, poly `0x07`, init `0x00`, no xorout |

CRC-8 is computed over the packed bytes of `studentId` (20 bits) followed by
`rollingCode` (20 bits) = 40 bits = exactly 5 bytes (MSB first, no padding).

The `rollingCode` field carries the value as a 20-bit unsigned integer, not as
ASCII digits. Display it to a human zero-padded to 6 digits (`004271`).

Reject the payload if the CRC does not match before doing any HMAC work.

## 4. Physical layer — binary FSK (`src/utils/audioSynthesizer.ts`)

| Parameter          | Default   | Meaning                               |
| ------------------ | --------- | ------------------------------------- |
| `sampleRate`       | 44100 Hz  | WAV render rate                       |
| `symbolMs`         | 20 ms     | one symbol = one FFT frame on the gate|
| `f0`               | 18000 Hz  | encodes bit `0`                       |
| `f1`               | 19000 Hz  | encodes bit `1`                       |
| `fPreamble`        | 17000 Hz  | sync tone                             |
| `preambleSymbols`  | 8         | sync tone repeated this many times    |
| `rampMs`           | 3 ms      | raised-cosine edge per symbol         |
| `leadSilenceMs`    | 40 ms     | before preamble                       |
| `trailSilenceMs`   | 40 ms     | after payload                         |

### Frame

```
[40 ms silence]
[fPreamble] x 8            <- gate: detect energy at fPreamble, lock symbol clock
[f1] x 1                   <- start marker: end of preamble / next symbol = bit 0 of payload
[payload] x 48             <- f1 if bit==1 else f0, one symbol each
[40 ms silence]
```

Total on-air time ≈ `(8 + 1 + 48) * 20 ms` = 1.14 s plus 80 ms silence.

### Gate decode notes

- FFT size 1024 at 44.1 kHz → ~43 Hz bins; `f0`/`f1` are ~23 bins apart, easily
  separable. A symbol (882 samples) fits one 1024-point frame with light
  zero-padding.
- Per symbol: compare magnitude at the `f0` bin vs the `f1` bin, take the larger.
- Use the preamble to estimate start-of-symbol offset; resync on the start
  marker.
- Tune the four frequencies together during the pilot for the specific
  speaker/mic pair, then update this table and `DEFAULT_CHIRP` in lockstep.

## 5. Replay resistance

A captured chirp is only replayable within the current 15 s window ± 1 step
(≤ 45 s). The gate SHOULD additionally cache accepted `(studentId, counter)`
pairs for ~60 s and reject a second use of the same pair.
