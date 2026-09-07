/**
 * SonicAccess — Phase 1 rolling ultrasonic token generator.
 *
 * The mobile client is the authenticator. It derives a short-lived one-time
 * code from a per-student shared secret (HOTP / RFC 4226 dynamic truncation,
 * keyed by a time counter as in TOTP / RFC 6238) and packs it, together with
 * the student id and an integrity check, into a fixed-width bit payload that
 * `audioSynthesizer` modulates into an inaudible FSK chirp.
 *
 * The ESP32 gate node performs the mirror operation: recover the bits from the
 * FFT decode, re-run this same derivation for the current counter (plus a small
 * drift window) and compare. Any change here MUST be mirrored in the gate
 * firmware — see src/PROTOCOL.md.
 */

import sha1Import from 'js-sha1';

/**
 * js-sha1's bundled types expose `hmac` only on a named `sha1` export, but the
 * CommonJS module is the hash function itself with `.hmac` attached. Re-type the
 * default import to the shape we actually use.
 */
const sha1 = sha1Import as unknown as {
  hmac: (secretKey: string, message: number[]) => string;
};

/** Length of one rolling window. The emitted code is valid for this long. */
export const TIME_STEP_MS = 30000;

/**
 * Rolling code is a 6-digit decimal, RFC 6238 / Google-Authenticator style:
 * `HOTP(secret, counter) mod 1_000_000`. 20 bits hold 0 .. 999_999.
 */
export const ROLLING_CODE_DIGITS = 6;
export const ROLLING_CODE_MODULUS = 10 ** ROLLING_CODE_DIGITS; // 1_000_000

/** Payload field widths, most-significant bit first. */
export const STUDENT_ID_BITS = 20; // 0 .. 1_048_575
export const ROLLING_CODE_BITS = 20; // holds the 6-digit code (max 999_999)
export const CHECKSUM_BITS = 8; // CRC-8 over id + rolling code
export const PAYLOAD_BITS = STUDENT_ID_BITS + ROLLING_CODE_BITS + CHECKSUM_BITS; // 48

export const MAX_STUDENT_ID = (1 << STUDENT_ID_BITS) - 1;

/** Zero-padded 6-digit string form of a rolling code, e.g. 4271 -> "004271". */
export function formatCode(code: number): string {
  return String(code).padStart(ROLLING_CODE_DIGITS, '0');
}

export interface SonicToken {
  /** Time counter the code was derived from (floor(epochMs / TIME_STEP_MS)). */
  counter: number;
  studentId: number;
  /** 6-digit rolling code, 0 .. 999_999 (HOTP truncated mod 1,000,000). */
  rollingCode: number;
  /** CRC-8 of the packed id + rolling code bytes. */
  checksum: number;
  /** MSB-first payload, exactly PAYLOAD_BITS entries, each 0 or 1. */
  bits: number[];
  generatedAt: number;
  /** Wall-clock time this code stops being current (start of next window). */
  expiresAt: number;
}

/* -------------------------------------------------------------------------- */
/* bit helpers                                                               */
/* -------------------------------------------------------------------------- */

export function numToBits(value: number, width: number): number[] {
  if (value < 0 || value > (2 ** width - 1)) {
    throw new RangeError(`value ${value} does not fit in ${width} bits`);
  }
  const bits = new Array<number>(width);
  for (let i = width - 1; i >= 0; i--) {
    bits[i] = value & 1;
    value = Math.floor(value / 2);
  }
  return bits;
}

export function bitsToNum(bits: number[]): number {
  return bits.reduce((acc, bit) => acc * 2 + (bit ? 1 : 0), 0);
}

/** Pack an MSB-first bit array into bytes, zero-padding the final byte. */
export function packBitsToBytes(bits: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | (bits[i + j] ? 1 : 0);
    }
    bytes.push(b & 0xff);
  }
  return bytes;
}

/** CRC-8, polynomial 0x07 (ATM / CCITT), init 0x00 — cheap to run on an MCU. */
export function crc8(bytes: number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

/* -------------------------------------------------------------------------- */
/* HOTP core                                                                 */
/* -------------------------------------------------------------------------- */

/** 8-byte big-endian counter, as RFC 4226 section 5.1. */
function counterBytes(counter: number): number[] {
  const out = new Array<number>(8).fill(0);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    out[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  return out;
}

/**
 * RFC 4226 HOTP value (31-bit unsigned) for `secret` at `counter`.
 * `secret` is used as the raw HMAC key bytes (UTF-8) — the gate must key the
 * exact same string.
 */
export function hotp(secret: string, counter: number): number {
  const hex = sha1.hmac(secret, counterBytes(counter)); // 40 hex chars, 20 bytes
  const hmacBytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    hmacBytes.push(parseInt(hex.substr(i, 2), 16));
  }
  const offset = hmacBytes[19] & 0x0f;
  const bin =
    ((hmacBytes[offset] & 0x7f) << 24) |
    (hmacBytes[offset + 1] << 16) |
    (hmacBytes[offset + 2] << 8) |
    hmacBytes[offset + 3];
  return bin >>> 0;
}

export function counterFor(now = Date.now()): number {
  return Math.floor(now / TIME_STEP_MS);
}

/* -------------------------------------------------------------------------- */
/* public API                                                               */
/* -------------------------------------------------------------------------- */

export function generateToken(
  secret: string,
  studentId: number,
  now = Date.now(),
): SonicToken {
  if (!secret) throw new Error('secret is required');
  if (!Number.isInteger(studentId) || studentId < 0 || studentId > MAX_STUDENT_ID) {
    throw new RangeError(`studentId must be an integer 0 .. ${MAX_STUDENT_ID}`);
  }

  const counter = counterFor(now);
  const rollingCode = hotp(secret, counter) % ROLLING_CODE_MODULUS;

  const idBits = numToBits(studentId, STUDENT_ID_BITS);
  const codeBits = numToBits(rollingCode, ROLLING_CODE_BITS);
  const checksum = crc8(packBitsToBytes([...idBits, ...codeBits]));
  const checkBits = numToBits(checksum, CHECKSUM_BITS);

  const bits = [...idBits, ...codeBits, ...checkBits];

  return {
    counter,
    studentId,
    rollingCode,
    checksum,
    bits,
    generatedAt: now,
    expiresAt: (counter + 1) * TIME_STEP_MS,
  };
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'length' | 'checksum' | 'code';
  studentId?: number;
  rollingCode?: number;
  /** Counter offset that matched (0 = current window, -1 = previous, …). */
  matchedDrift?: number;
}

/**
 * Reference verifier — mirrors the gate check. Kept here so the client can
 * self-test an emitted payload and so unit tests do not fork the logic.
 * `driftSteps` accepts codes from that many windows on either side of now.
 */
export function verifyToken(
  secret: string,
  bits: number[],
  now = Date.now(),
  driftSteps = 1,
): VerifyResult {
  if (bits.length !== PAYLOAD_BITS) return { ok: false, reason: 'length' };

  const idBits = bits.slice(0, STUDENT_ID_BITS);
  const codeBits = bits.slice(STUDENT_ID_BITS, STUDENT_ID_BITS + ROLLING_CODE_BITS);
  const checkBits = bits.slice(STUDENT_ID_BITS + ROLLING_CODE_BITS);

  const studentId = bitsToNum(idBits);
  const rollingCode = bitsToNum(codeBits);
  const checksum = bitsToNum(checkBits);

  if (crc8(packBitsToBytes([...idBits, ...codeBits])) !== checksum) {
    return { ok: false, reason: 'checksum', studentId, rollingCode };
  }

  const base = counterFor(now);
  for (let d = 0; d >= -driftSteps; d--) {
    // check current then older windows first (emitted code is most likely late)
    const expected = hotp(secret, base + d) % ROLLING_CODE_MODULUS;
    if (expected === rollingCode) {
      return { ok: true, studentId, rollingCode, matchedDrift: d };
    }
  }
  for (let d = 1; d <= driftSteps; d++) {
    const expected = hotp(secret, base + d) % ROLLING_CODE_MODULUS;
    if (expected === rollingCode) {
      return { ok: true, studentId, rollingCode, matchedDrift: d };
    }
  }
  return { ok: false, reason: 'code', studentId, rollingCode };
}
