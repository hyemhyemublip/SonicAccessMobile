# src/services/

Non-UI logic. Safe to unit-test in plain Node.

## `tokenGenerator.ts`

The security-critical path. Produces the rolling acoustic token.

- `generateToken(secret, studentId, now?)` → `SonicToken` with a 48-bit `bits`
  payload (MSB first): `studentId(20) | rollingCode(20) | CRC-8(8)`.
- `rollingCode = HOTP(secret, floor(now / TIME_STEP_MS)) mod 1_000_000` (6-digit
  decimal, RFC 6238 style), HOTP per
  RFC 4226 (HMAC-SHA1, dynamic truncation). `TIME_STEP_MS = 15000`.
- `verifyToken(secret, bits, now?, driftSteps?)` — reference verifier that
  mirrors the gate check (current window ± `driftSteps`). Used for the client
  self-check before emitting and by `scripts/token-selftest.mjs`.
- Also exports `hotp`, `crc8`, `numToBits`, `bitsToNum`, `packBitsToBytes` so
  tests and the seed generator do not fork the logic.

The secret is used as the **raw UTF-8 HMAC key** — the gate must key the exact
same string. Parameters are documented in `../PROTOCOL.md`.

## `authService.ts`

On-device enrollment, stored in the OS keychain via `expo-secure-store`.

- `enroll({ studentId, secret, name? })` — validates then persists.
- `getCredential()` / `isEnrolled()` / `clearCredential()`.
- `validateCredential(partial)` — returns an error string or `null`; reused by
  the enrollment form.

Keys: `sonic.studentId`, `sonic.secret`, `sonic.name`.

## `clock.ts`

Best-effort device-clock sanity check — no network reference (Phase 1 is
offline).

- `checkClock(now?)` → `{ ok, reason?, detail? }`. Fails if the year is outside
  2025–2100 or the clock is set earlier than `config.BUILD_EPOCH_MS` (minus a
  day's slack).
- `clockWarning(now?)` → a one-line UI string, or `null` when the clock looks
  fine. `GatePassScreen` shows it as a banner.

Rationale: the rolling code is time-based; if the phone clock drifts past the
gate's ~30–45 s acceptance window every emit is silently rejected. Bump
`BUILD_EPOCH_MS` in `src/config.ts` on each release.

## Tests

```bash
npm run selftest   # RFC 4226 vectors, CRC-8 check value, roll/drift/tamper cases
```
