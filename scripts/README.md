# scripts/

Node utilities. All run with `node --experimental-strip-types` (Node 22+),
so they import the `.ts` sources directly — no build step, no extra deps.

| Script                | npm alias          | What                                            |
| --------------------- | ------------------ | ---------------------------------------------- |
| `token-selftest.mjs`  | `npm run selftest` | Verifies the rolling-token core: RFC 4226 HOTP vectors, CRC-8 check value, payload round-trip, window rolling, drift accept/reject, tamper + wrong-secret rejection. |
| `fsk-decoder.mjs`     | `npm run decode`   | Software reference decoder — WAV → preamble lock → per-symbol Goertzel → 48 bits → CRC → `verifyToken`. Exact mirror of `src/PROTOCOL.md`; the spec the ESP32 firmware must match. Importable (`decodeWav`, `parseWav`) or a CLI. |
| `roundtrip-test.mjs`  | `npm run test:audio` | token → `buildWaveform` → `encodeWav` → `decodeWav` → verify, under a leading offset, additive noise, low amplitude, trailing garbage; plus silence-rejection and tamper→CRC cases. |
| `seed-students.mjs`   | `npm run seed`     | (Re)generates `seed/students.json` — the sample student roster. |

`npm test` runs typecheck + `selftest` + `test:audio` together.

## `fsk-decoder.mjs` CLI

```bash
npm run decode -- path/to/recording.wav                 # decode + CRC
npm run decode -- path/to/recording.wav <shared-secret> # + verifyToken (ACCEPT/REJECT)
```

Accepts 16-bit PCM mono WAV. Searches for the preamble (tolerates arbitrary
leading silence), so a raw mic capture works, not just a clean synthesized file.

## `seed-students.mjs` options

```bash
npm run seed                     # create seed/students.json (fails if it exists)
npm run seed -- --show           # print the EXISTING roster, no changes
npm run seed -- --show --vectors # existing roster + each student's current code
npm run seed -- --force          # regenerate — ROTATES EVERY SECRET
npm run seed -- --count 60       # more students (cycles the name list)
npm run seed -- --vectors        # print codes right after generating
```

Use `--show` to view what's already there. `--force` is only for a fresh
rotation and breaks any device enrolled against the old secrets.

`--vectors` prints live gate-side test vectors: for each student, the current
15-second `counter` and the 6-digit `rollingCode`. They expire in ~15 s — use them to
sanity-check a gate decoder against a known-good value right now.

## Note

These are dev/test tools, not shipped with the app. The `MODULE_TYPELESS_PACKAGE_JSON`
warning from Node is expected (it is just noting the on-the-fly TS strip).
