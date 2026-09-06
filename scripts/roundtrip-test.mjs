/**
 * Round-trip test: token -> FSK waveform -> WAV -> reference decoder -> verify.
 *
 *   node --experimental-strip-types scripts/roundtrip-test.mjs
 *   npm run test:audio
 *
 * Proves the modulator (`audioSynthesizer`) and the reference decoder
 * (`fsk-decoder`) agree on the wire format, and that the decoder survives a
 * leading offset, additive noise, and trailing garbage — the conditions a real
 * mic recording will have. The FSK frequencies / symbol length are still
 * provisional (hardware tuning), so this guards the *format*, not the RF budget.
 */

import {
  DEFAULT_CHIRP,
  buildWaveform,
  encodeWav,
} from '../src/utils/audioSynthesizer.ts';
import {
  formatCode,
  generateToken,
} from '../src/services/tokenGenerator.ts';
import { decodeWav } from './fsk-decoder.mjs';

let fails = 0;
const check = (cond, msg) => {
  if (!cond) {
    console.log('FAIL:', msg);
    fails++;
  }
};

const SECRET = 'round-trip-secret-value';
const STUDENT_ID = 231868;
const NOW = 1_700_000_000_000;

const token = generateToken(SECRET, STUDENT_ID, NOW);

/** samples (float[]) -> WAV bytes at the default sample rate */
const toWav = (samples) => encodeWav(samples, DEFAULT_CHIRP.sampleRate);

/** deterministic-ish PRNG so a failure reproduces */
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2;

function assertDecodes(wav, label, { expectVerify = true } = {}) {
  const res = decodeWav(wav);
  check(res.ok, `${label}: decoder locked`);
  if (!res.ok) return;
  check(
    JSON.stringify(res.bits) === JSON.stringify(token.bits),
    `${label}: 48 bits identical`,
  );
  check(res.crcOk, `${label}: CRC-8 OK`);
  check(res.studentId === STUDENT_ID, `${label}: studentId ${res.studentId}`);
  check(
    res.rollingCode === token.rollingCode,
    `${label}: rollingCode ${formatCode(res.rollingCode)}`,
  );
}

/* 1. clean */
const clean = buildWaveform(token.bits, DEFAULT_CHIRP).samples;
assertDecodes(toWav(clean), 'clean');

/* 2. leading offset (arbitrary silence before the chirp) */
const offset = new Array(3211).fill(0).concat(clean);
assertDecodes(toWav(offset), 'leading offset');

/* 3. additive noise (~ -26 dBFS) + offset + trailing garbage */
const noiseAmp = 0.05;
const noisy = new Array(1500)
  .fill(0)
  .concat(clean)
  .concat(new Array(4000).fill(0))
  .map((s) => s + gauss() * noiseAmp);
assertDecodes(toWav(noisy), 'noise + offset + trailing');

/* 4. quieter chirp (speaker not at full volume) still decodes */
const quiet = clean.map((s) => s * 0.35 + gauss() * 0.01);
assertDecodes(toWav(quiet), 'low amplitude');

/* 5. pure silence must NOT produce a lock */
const silence = new Array(clean.length).fill(0).map(() => gauss() * 0.002);
const sres = decodeWav(toWav(silence));
check(!sres.ok, 'silence: no false lock');

/* 6. tampered payload: decoder still reads bits, CRC catches it */
const tamperedBits = token.bits.slice();
tamperedBits[5] ^= 1;
const tamperedWav = toWav(buildWaveform(tamperedBits, DEFAULT_CHIRP).samples);
const tres = decodeWav(tamperedWav);
check(tres.ok && !tres.crcOk, 'tampered payload: CRC fails');

console.log(
  fails === 0
    ? `\nALL PASS  (code ${formatCode(token.rollingCode)}, ${token.bits.length} bits)`
    : `\n${fails} FAILED`,
);
process.exit(fails ? 1 : 0);
