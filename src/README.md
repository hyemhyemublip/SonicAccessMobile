# src/

All application code for the Phase 1 client.

| Path              | Responsibility                                                  |
| ----------------- | -------------------------------------------------------------- |
| `screens/`        | UI screens: enroll, unlock, gate pass.                         |
| `services/`       | Non-UI logic: token derivation, secret vault, enrollment, clock. |
| `utils/`          | Pure helpers with no app state: the FSK audio modulator.       |
| `config.ts`       | App flags / build constants (`SHOW_DEBUG`, `BUILD_EPOCH_MS`, `MIN_PASSWORD_LENGTH`). |
| `PROTOCOL.md`     | The acoustic-token wire contract. **Shared with the ESP32 firmware — treat every constant in it as frozen for deployed gates.** |

## Data flow

```
EnrollScreen: scan QR -> parseEnrollPayload -> { studentId, secret }
        |  + unlock password
authService.enroll -> vault.wrapSecret (scrypt + XChaCha20-Poly1305)
        |
   [ expo-secure-store: metadata + sealed blob;  raw secret discarded ]
        |
UnlockScreen: password -> authService.unlock -> vault.unwrapSecret -> secret (memory only)
        |
tokenGenerator.generateToken(secret, studentId)  -> 48-bit payload (id + rollingCode + CRC-8)
        |
audioSynthesizer.synthesizeChirp()               -> file:// WAV (ultrasonic FSK)
        |
GatePassScreen -> expo-audio createAudioPlayer(uri).play()
        |
   (air gap)
        |
ESP32 gate node: FFT decode -> re-derive rollingCode -> open gate
```

## Rules

- Anything that changes the payload layout, the HOTP parameters, or the FSK
  frequencies/timing **must** be mirrored in `PROTOCOL.md` and the firmware in
  the same change. There is no negotiation on the air.
- At rest the secret is only ciphertext (`vault`); in memory it lives just for
  the unlocked session (held by `App`, dropped on background). Never log it,
  never persist it in the clear, never send it anywhere.
- Keep `utils/` pure (no imports of `services/` or React). `services/` may use
  `utils/` and `config`. `screens/` may use both.
