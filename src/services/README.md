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

## `vault.ts`

Password-wrapped secret store. The 160-bit shared secret is kept **only as
ciphertext**: sealed with XChaCha20-Poly1305 under a key from
`scrypt(password, salt)`. The password is never persisted.

- `wrapSecret(secret, password)` → `VaultBlob { v, salt, nonce, ct }` (all base64).
- `unwrapSecret(blob, password)` → the secret, or throws `WrongPassword` on a
  Poly1305 tag mismatch (wrong password or tampered blob).
- `KDF_PARAMS` — scrypt cost (`N=2^14`), tunable here.

`@noble/hashes` (scrypt) + `@noble/ciphers` (xchacha20poly1305), pure JS. Random
bytes come from `expo-crypto` on device, WebCrypto under tests.

## `enrollmentCode.ts`

Parses the registrar's enrollment payload —
`{ t:"sonicaccess/v1", sid, sec, nm? }`, raw JSON or base64.

- `parseEnrollPayload(raw)` → `{ studentId, secret, name? }`, throws with a
  friendly message on anything malformed / out of range.
- `buildEnrollPayload(p)` → the string form (registrar tool / tests).

Pilot note: the payload is unsigned. Production should make it a one-time,
server-issued token so a leaked QR can't be reused.

## `authService.ts`

Enrollment + unlock. Non-secret metadata (`studentId`, `name`) and the
`VaultBlob` live in `expo-secure-store`; the raw secret is only ever in memory.

- `enroll({ studentId, secret, password, name? })` — wraps the secret with the
  password (`vault`) and stores blob + metadata.
- `getEnrollment()` → `{ studentId, name? } | null` · `isEnrolled()` ·
  `clearEnrollment()`.
- `unlock(password)` → the decrypted secret. Throws `WrongPasswordError`
  (`.attemptsLeft`) or `LockedOut` after `MAX_UNLOCK_ATTEMPTS` wrong tries — at
  which point the vault self-wipes and re-enrollment is required.
- `validateStudentId` / `validatePassword` — form helpers.

Keys: `sonic.enrollment.meta`, `sonic.enrollment.vault`, `sonic.enrollment.fails`.

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
npm run selftest      # RFC 4226 vectors, CRC-8 check value, roll/drift/tamper
npm run test:enroll   # enrollment-code parsing + vault wrap/unwrap/wrong-pw/tamper
```
