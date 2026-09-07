/**
 * Self-test for the enrollment code parser and the password-wrapped secret
 * vault (`src/services/enrollmentCode.ts`, `src/services/vault.ts`).
 *
 *   node --experimental-strip-types scripts/enroll-selftest.mjs
 *   npm run test:enroll
 *
 * Security-critical: proves the secret round-trips through a password, a wrong
 * password is rejected (Poly1305 tag), and a tampered blob is rejected.
 */

import {
  buildEnrollPayload,
  parseEnrollPayload,
} from '../src/services/enrollmentCode.ts';
import { WrongPassword, unwrapSecret, wrapSecret } from '../src/services/vault.ts';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.log('FAIL:', msg);
    fails++;
  }
};

/* -- enrollment code parsing ----------------------------------------------- */

const payload = { studentId: 231868, secret: 'SZCGVTXAKJWPLFZ5WN6SEGG72R7O7OVQ', name: 'Jumuad, S.' };
const raw = buildEnrollPayload(payload);

const parsed = parseEnrollPayload(raw);
ok(parsed.studentId === payload.studentId, 'parse: studentId');
ok(parsed.secret === payload.secret, 'parse: secret');
ok(parsed.name === payload.name, 'parse: name');

// base64-wrapped form
const b64 = Buffer.from(raw).toString('base64');
ok(parseEnrollPayload(b64).secret === payload.secret, 'parse: base64 form');

// rejects
const rejects = [
  ['', 'empty'],
  ['not json', 'garbage'],
  [JSON.stringify({ t: 'other/v1', sid: 1, sec: 'xxxxxxxx' }), 'wrong type tag'],
  [JSON.stringify({ t: 'sonicaccess/v1', sid: 9_999_999, sec: 'xxxxxxxx' }), 'studentId out of range'],
  [JSON.stringify({ t: 'sonicaccess/v1', sid: 5, sec: 'short' }), 'secret too short'],
];
for (const [input, label] of rejects) {
  let threw = false;
  try {
    parseEnrollPayload(input);
  } catch {
    threw = true;
  }
  ok(threw, `parse rejects: ${label}`);
}

/* -- vault wrap / unwrap ------------------------------------------------------ */

const SECRET = 'SZCGVTXAKJWPLFZ5WN6SEGG72R7O7OVQ';
const PW = 'correct horse battery';

const blob = await wrapSecret(SECRET, PW);
ok(blob.v === 1 && blob.salt && blob.nonce && blob.ct, 'wrap: blob shape');
ok(!blob.ct.includes(SECRET) && !JSON.stringify(blob).includes(SECRET), 'wrap: secret not in blob');

ok((await unwrapSecret(blob, PW)) === SECRET, 'unwrap: round-trips with the right password');

let wrong = false;
try {
  await unwrapSecret(blob, 'wrong password');
} catch (e) {
  wrong = e instanceof WrongPassword;
}
ok(wrong, 'unwrap: wrong password -> WrongPassword');

// tamper a byte of the ciphertext
const tampered = { ...blob, ct: Buffer.from((() => {
  const b = Buffer.from(blob.ct, 'base64');
  b[0] ^= 1;
  return b;
})()).toString('base64') };
let tamperRejected = false;
try {
  await unwrapSecret(tampered, PW);
} catch (e) {
  tamperRejected = e instanceof WrongPassword;
}
ok(tamperRejected, 'unwrap: tampered ciphertext rejected');

// two wraps of the same secret differ (random salt + nonce)
const blob2 = await wrapSecret(SECRET, PW);
ok(blob2.salt !== blob.salt && blob2.ct !== blob.ct, 'wrap: fresh salt/nonce each time');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
