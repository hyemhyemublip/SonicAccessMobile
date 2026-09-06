/**
 * Dependency-free self-test for the SonicAccess rolling-token core.
 * Run:  node --experimental-strip-types scripts/token-selftest.mjs
 *
 * Covers RFC 4226 HOTP test vectors, CRC-8 check value, payload round-trip,
 * window rolling, drift acceptance, and tamper/secret rejection. This is the
 * security-critical path; keep it green.
 */

import {
  generateToken,
  verifyToken,
  hotp,
  crc8,
  numToBits,
  bitsToNum,
  PAYLOAD_BITS,
  TIME_STEP_MS,
} from '../src/services/tokenGenerator.ts';

let fails = 0;
const eq = (got, want, msg) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log('FAIL:', msg, '\n  got ', got, '\n  want', want);
    fails++;
  }
};

// RFC 4226 Appendix D — seed "12345678901234567890" (ASCII, used as raw key)
eq(hotp('12345678901234567890', 0) % 1_000_000, 755224, 'RFC4226 c=0');
eq(hotp('12345678901234567890', 1) % 1_000_000, 287082, 'RFC4226 c=1');
eq(hotp('12345678901234567890', 5) % 1_000_000, 254676, 'RFC4226 c=5');
eq(hotp('12345678901234567890', 9) % 1_000_000, 520489, 'RFC4226 c=9');

// CRC-8/SMBUS check value for ASCII "123456789"
eq(crc8([...'123456789'].map((c) => c.charCodeAt(0))), 0xf4, 'CRC-8 check value');

// bit helpers round-trip
eq(bitsToNum(numToBits(1_048_575, 20)), 1_048_575, 'numToBits/bitsToNum max');
eq(bitsToNum(numToBits(0, 16)), 0, 'numToBits/bitsToNum zero');

const T0 = 1_700_000_000_000;
const tok = generateToken('campus-shared-secret', 231868, T0);
eq(tok.bits.length, PAYLOAD_BITS, 'payload width = 48');
eq(tok.rollingCode >= 0 && tok.rollingCode <= 999_999, true, 'rollingCode is 6-digit');
eq(tok.studentId, 231868, 'studentId preserved');
eq(tok.expiresAt % TIME_STEP_MS, 0, 'expiry aligned to window');

eq(verifyToken('campus-shared-secret', tok.bits, T0).ok, true, 'verify current window');
eq(
  verifyToken('campus-shared-secret', tok.bits, T0 + TIME_STEP_MS).ok,
  true,
  'verify accepts +1 window (late arrival)',
);
eq(
  verifyToken('campus-shared-secret', tok.bits, T0 + 3 * TIME_STEP_MS).ok,
  false,
  'verify rejects beyond drift',
);

const wrong = verifyToken('WRONG-secret', tok.bits, T0);
eq(wrong.ok, false, 'wrong secret rejected');
eq(wrong.reason, 'code', 'wrong secret fails at code (CRC still valid)');

const tampered = tok.bits.slice();
tampered[3] ^= 1;
eq(
  verifyToken('campus-shared-secret', tampered, T0).reason,
  'checksum',
  'single-bit tamper caught by CRC',
);

eq(verifyToken('campus-shared-secret', tok.bits.slice(0, 20)).reason, 'length', 'short payload rejected');

// rolling behaviour
const a = generateToken('s', 5, 0);
const b = generateToken('s', 5, TIME_STEP_MS);
eq(a.counter + 1, b.counter, 'counter increments per window');
eq(a.rollingCode !== b.rollingCode, true, 'code changes across windows');
eq(generateToken('s', 5, 1).rollingCode, generateToken('s', 5, TIME_STEP_MS - 1).rollingCode, 'code stable within a window');

// id bounds
let threw = false;
try {
  generateToken('s', 2 ** 20, 0);
} catch {
  threw = true;
}
eq(threw, true, 'studentId overflow rejected');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
