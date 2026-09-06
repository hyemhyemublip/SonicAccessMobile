# src/utils/

Pure helpers. No React, no `services/`, no app state.

## `audioSynthesizer.ts`

Binary FSK modulator: bit payload → ultrasonic WAV.

- `synthesizeChirp(bits, cfg?)` → `{ uri, durationMs, symbolCount, config }`.
  Renders the waveform, wraps it in a 16-bit mono PCM WAV, base64-encodes it,
  and writes it to the cache dir (`expo-file-system`). The `uri` goes straight
  to `createAudioPlayer`.
- `buildWaveform(bits, cfg?)` → `{ samples, symbolCount }` — the float waveform
  only, no file I/O.
- `encodeWav(samples, sampleRate)` → `Uint8Array` — 16-bit mono PCM WAV bytes.
- `cleanupChirps()` — deletes `sonic-chirp-*.wav` left in the cache.
- `DEFAULT_CHIRP` — the tunable config (frequencies, symbol length, preamble,
  ramp, silence padding).

`buildWaveform` / `encodeWav` / `DEFAULT_CHIRP` are pure and import cleanly into
plain Node — the reference decoder and `npm run test:audio` use them.
`expo-file-system` is loaded lazily, only inside `synthesizeChirp` /
`cleanupChirps`, so importing this module off-device does not pull native code.
The matching decoder is `scripts/fsk-decoder.mjs`.

### Frame

```
[lead silence] [fPreamble x N] [f1 x 1 start marker] [payload: f1=1 / f0=0] [trail silence]
```

Defaults: `f0` 18 kHz, `f1` 19 kHz, `fPreamble` 17 kHz, 20 ms/symbol, 8 preamble
symbols, 3 ms raised-cosine edge per symbol (suppresses clicks and out-of-band
splatter), 40 ms silence each end. Phase is continuous across symbols.

**These four frequencies and the timing must match the gate FFT decoder.** See
`../PROTOCOL.md`; retune both together during the hardware pilot.

### Notes

- 44.1 kHz sample rate → 22.05 kHz Nyquist, so 17–19 kHz is safe. This band is
  near-inaudible to most people but within phone-speaker / MEMS-mic response.
- WAV (uncompressed PCM) is deliberate: MP3/AAC would smear the tones.
