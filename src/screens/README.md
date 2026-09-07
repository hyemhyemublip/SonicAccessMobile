# src/screens/

UI screens.

## `GatePassScreen.tsx`

The whole Phase 1 user flow in one screen.

### States

| Phase     | Shows                                                              |
| --------- | --------------------------------------------------------------- |
| `loading` | spinner while `getCredential()` runs                             |
| `enroll`  | manual enrollment form (student id + secret + optional name)     |
| `ready`   | big 6-digit code card (grouped `074 653`) + countdown bar, "Emit gate pass" button, re-enroll link |

The code card is authenticator-style: `generateToken` is re-run about 3×/second
so the displayed code is always the current-window one, whether or not you have
emitted yet. The bar shrinks over the 15 s window and turns amber in the last
few seconds; **Emit** modulates whatever code is showing and plays the chirp.

### Emit sequence

1. `generateToken(secret, studentId)` for the current 15 s window.
2. `verifyToken` self-check — never broadcast a payload that fails locally.
3. `synthesizeChirp(bits)` → cache WAV uri.
4. `createAudioPlayer(uri).play()`; the player is released on
   `didJustFinish` and on unmount.
5. Countdown ticks down to `token.expiresAt`; after that, emit again.

### Notes

- Calls `setAudioModeAsync({ playsInSilentMode: true })` so the chirp plays with
  the ringer switch off.
- `emitting` guards against double-taps.
- The `window <counter>` diagnostic line is gated on `config.SHOW_DEBUG`
  (`__DEV__`) — it's off in a release build.
- A clock-drift banner (`services/clock` → `clockWarning`) appears above the
  code card when the device time looks wrong, since the rolling code depends on
  it.
- Needs a real device: simulators have no speaker.
