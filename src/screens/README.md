# src/screens/

UI screens. `App.tsx` is the router: `loading → enroll → locked → unlocked`.

| Screen | When | Does |
| --- | --- | --- |
| `EnrollScreen` | not enrolled | scan the registrar QR (`expo-camera`) or paste the code → set an unlock password (+ optional "unlock with fingerprint / Face ID" toggle) → `authService.enroll` seals the secret. |
| `UnlockScreen` | enrolled, locked | password → `authService.unlock`; or the biometric button / auto-prompt on mount → `unlockBiometric`. Hands the decrypted secret up. Shows attempts-left; self-wipes + routes to re-enroll after `MAX_UNLOCK_ATTEMPTS`. |
| `GatePassScreen` | unlocked | `{ studentId, name, secret, onLock }` props. Live 6-digit code + countdown + emit; clock-drift banner; `Lock` button; a **fingerprint / Face ID toggle** (`enableBiometric` / `disableBiometric`) so it can be turned on/off after enrollment. No persistence — the secret is a prop. |

`App` re-locks (drops the in-memory secret) once the app has been backgrounded
longer than `SESSION_TTL_MS`; briefer background trips (notification shade, quick
app switch) keep the session.

## `GatePassScreen` emit sequence

1. `generateToken(secret, studentId)` for the current 30 s window.
2. `verifyToken` self-check — never broadcast a payload that fails locally.
3. `synthesizeChirp(bits)` → cache WAV uri.
4. `createAudioPlayer(uri).play()`; released on `didJustFinish` and on unmount.
5. Countdown to `token.expiresAt`; after that, emit again.

## Notes

- The code card is authenticator-style: `generateToken` re-runs ~3×/second so
  the displayed code is always the current-window one. The bar turns amber in
  the last few seconds.
- `config.SHOW_DEBUG` (`__DEV__`) gates the `window <counter>` diagnostic line —
  off in a release build.
- A clock-drift banner (`services/clock` → `clockWarning`) appears above the
  code card when the device time looks wrong.
- Needs a real device: simulators have no speaker, and the QR scanner needs a
  camera.
