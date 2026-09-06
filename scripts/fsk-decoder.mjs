/**
 * Software reference decoder for the SonicAccess acoustic token.
 *
 *   node --experimental-strip-types scripts/fsk-decoder.mjs <file.wav> [secret]
 *
 * This is the exact mirror of `src/PROTOCOL.md` §4 (demod) + §2–3 (payload):
 *   WAV -> samples -> preamble lock -> per-symbol Goertzel -> 48 bits ->
 *   CRC-8 check -> (optional) verifyToken against a secret.
 *
 * It is the spec the ESP32 firmware must match, and the decoder the round-trip
 * test and the gate simulator use. No external dependencies.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_CHIRP } from '../src/utils/audioSynthesizer.ts';
import {
  CHECKSUM_BITS,
  PAYLOAD_BITS,
  ROLLING_CODE_BITS,
  STUDENT_ID_BITS,
  bitsToNum,
  crc8,
  formatCode,
  packBitsToBytes,
  verifyToken,
} from '../src/services/tokenGenerator.ts';

/* -- WAV parsing --------------------------------------------------------- */

/** Minimal RIFF/WAVE reader. Returns channel-0 samples as Float64 in -1..1. */
export function parseWav(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('latin1', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        sampleRate: b.readUInt32LE(body + 4),
        bitsPerSample: b.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, b.length - body);
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error('missing fmt or data chunk');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error('expected 16-bit PCM');
  }
  const step = 2 * fmt.channels;
  const n = Math.floor(dataLen / step);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(dataOff + i * step) / 32768;
  return { samples, sampleRate: fmt.sampleRate, channels: fmt.channels };
}

/* -- tone power (generalized Goertzel) --------------------------------- */

function tonePower(s, start, n, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = s[start + i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/* -- decode ------------------------------------------------------------- */

/**
 * @param input  WAV file path, Buffer, or Uint8Array
 * @returns { ok, reason?, preambleAt?, bits?, studentId?, rollingCode?,
 *            checksum?, crcOk? }
 */
export function decodeWav(input, cfgOverride = {}) {
  const buf = typeof input === 'string' ? readFileSync(input) : input;
  const { samples, sampleRate } = parseWav(buf);
  const cfg = { ...DEFAULT_CHIRP, ...cfgOverride };

  const nSym = Math.round((cfg.symbolMs / 1000) * sampleRate);
  const P = cfg.preambleSymbols;
  const framed = (P + 1 + PAYLOAD_BITS) * nSym;
  if (samples.length < framed) return { ok: false, reason: 'audio-too-short' };

  // RMS floor so pure silence / hiss does not "lock".
  let sq = 0;
  for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
  const rms = Math.sqrt(sq / samples.length);
  const minScore = rms * rms * nSym * 0.02;

  // On a real preamble, fPreamble dominates the f0/f1 bins by a wide margin.
  // On noise / silence, all three bins carry similar power, so this ratio — not
  // an absolute level — is what separates a lock from garbage.
  const MIN_TONE_RATIO = 2.0;

  const scoreAt = (start) => {
    let pre = 0;
    let leak = 0;
    for (let k = 0; k < P; k++) {
      const w = start + k * nSym;
      pre += tonePower(samples, w, nSym, cfg.fPreamble, sampleRate);
      leak += Math.max(
        tonePower(samples, w, nSym, cfg.f0, sampleRate),
        tonePower(samples, w, nSym, cfg.f1, sampleRate),
      );
    }
    pre /= P;
    leak = leak / P + 1e-12;
    const m = start + P * nSym; // start-marker symbol (a single bit-1 tone)
    const m1 = tonePower(samples, m, nSym, cfg.f1, sampleRate);
    const m0 = tonePower(samples, m, nSym, cfg.f0, sampleRate);
    const mp = tonePower(samples, m, nSym, cfg.fPreamble, sampleRate);
    const markerOk = m1 > m0 && m1 > mp;
    return { score: pre * (markerOk ? 1 : 0.25), pre, ratio: pre / leak };
  };

  const maxStart = samples.length - framed;
  const coarse = Math.max(4, Math.round(nSym / 16));
  let best = -1;
  let bestScore = -Infinity;
  let bestRatio = 0;
  const consider = (s) => {
    const r = scoreAt(s);
    if (r.score > bestScore) {
      bestScore = r.score;
      bestRatio = r.ratio;
      best = s;
    }
  };
  for (let s = 0; s <= maxStart; s += coarse) consider(s);
  for (
    let s = Math.max(0, best - nSym);
    s <= Math.min(maxStart, best + nSym);
    s += 2
  ) {
    consider(s);
  }
  if (best < 0 || bestScore <= minScore || bestRatio < MIN_TONE_RATIO) {
    return { ok: false, reason: 'no-preamble' };
  }

  const payloadStart = best + (P + 1) * nSym;
  const bits = new Array(PAYLOAD_BITS);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    const w = payloadStart + i * nSym;
    const p1 = tonePower(samples, w, nSym, cfg.f1, sampleRate);
    const p0 = tonePower(samples, w, nSym, cfg.f0, sampleRate);
    bits[i] = p1 > p0 ? 1 : 0;
  }

  const idBits = bits.slice(0, STUDENT_ID_BITS);
  const codeBits = bits.slice(STUDENT_ID_BITS, STUDENT_ID_BITS + ROLLING_CODE_BITS);
  const checkBits = bits.slice(STUDENT_ID_BITS + ROLLING_CODE_BITS);
  const studentId = bitsToNum(idBits);
  const rollingCode = bitsToNum(codeBits);
  const checksum = bitsToNum(checkBits);
  const crcOk = crc8(packBitsToBytes([...idBits, ...codeBits])) === checksum;

  return {
    ok: true,
    preambleAt: best,
    payloadStart,
    bits,
    studentId,
    rollingCode,
    checksum,
    crcOk,
  };
}

/* -- CLI -------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith('fsk-decoder.mjs');

if (invokedDirectly) {
  const [, , file, secret] = process.argv;
  if (!file) {
    console.error('usage: fsk-decoder.mjs <file.wav> [secret]');
    process.exit(2);
  }
  const res = decodeWav(file);
  if (!res.ok) {
    console.log(`decode failed: ${res.reason}`);
    process.exit(1);
  }
  console.log(`preamble locked at sample ${res.preambleAt}`);
  console.log(`studentId    ${res.studentId}`);
  console.log(`rollingCode  ${formatCode(res.rollingCode)}`);
  console.log(`checksum     ${res.checksum}  (CRC ${res.crcOk ? 'OK' : 'FAIL'})`);
  console.log(`payload bits ${res.bits.length}/${PAYLOAD_BITS}  (${CHECKSUM_BITS}-bit check)`);
  if (secret) {
    const v = verifyToken(secret, res.bits);
    console.log(
      `verifyToken  ${v.ok ? 'ACCEPT' : `REJECT (${v.reason})`}` +
        (v.matchedDrift != null ? `  drift ${v.matchedDrift}` : ''),
    );
    process.exit(v.ok ? 0 : 1);
  }
  process.exit(res.crcOk ? 0 : 1);
}
