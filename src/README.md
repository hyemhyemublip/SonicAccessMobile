# src/

All application code for the Phase 1 client.

| Path              | Responsibility                                                  |
| ----------------- | -------------------------------------------------------------- |
| `screens/`        | UI screens. Currently just the gate-pass flow.                 |
| `services/`       | Non-UI logic: token derivation, credential storage.            |
| `utils/`          | Pure helpers with no app state: the FSK audio modulator.       |
| `config.ts`       | App flags / build constants (`SHOW_DEBUG`, `BUILD_EPOCH_MS`).  |
| `PROTOCOL.md`     | The acoustic-token wire contract. **Shared with the ESP32 firmware — treat every constant in it as frozen for deployed gates.** |

## Data flow

```
authService.getCredential()        -> { studentId, secret }
        |
tokenGenerator.generateToken()     -> 48-bit payload (id + rollingCode + CRC-8)
        |
audioSynthesizer.synthesizeChirp() -> file:// WAV (ultrasonic FSK)
        |
GatePassScreen  ->  expo-audio createAudioPlayer(uri).play()
        |
   (air gap)
        |
ESP32 gate node: FFT decode -> re-derive rollingCode -> open gate
```

## Rules

- Anything that changes the payload layout, the HOTP parameters, or the FSK
  frequencies/timing **must** be mirrored in `PROTOCOL.md` and the firmware in
  the same change. There is no negotiation on the air.
- The secret never leaves `expo-secure-store`. Do not log it, do not put it in
  component state longer than a render, do not send it anywhere.
- Keep `utils/` pure (no imports of `services/` or React). `services/` may use
  `utils/` and `config`. `screens/` may use both.
