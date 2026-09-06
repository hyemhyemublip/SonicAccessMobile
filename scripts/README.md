# scripts/

Node utilities. All run with `node --experimental-strip-types` (Node 22+),
so they import the `.ts` sources directly — no build step, no extra deps.

| Script                | npm alias        | What                                              |
| --------------------- | ---------------- | ------------------------------------------------ |
| `token-selftest.mjs`  | `npm run selftest` | Verifies the rolling-token core: RFC 4226 HOTP vectors, CRC-8 check value, payload round-trip, window rolling, drift accept/reject, tamper + wrong-secret rejection. Exit non-zero on any failure. |
| `seed-students.mjs`   | `npm run seed`   | (Re)generates `seed/students.json` — the sample student roster. |

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
