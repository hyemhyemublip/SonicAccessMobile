/**
 * Seed generator for the SonicAccess student roster.
 *
 *   node --experimental-strip-types scripts/seed-students.mjs [options]
 *   npm run seed -- [options]
 *
 * Options:
 *   --force        overwrite seed/students.json if it already exists
 *   --count <n>    number of students (default: length of the built-in list)
 *   --vectors      also print the CURRENT rolling code for each student
 *                  (a live gate-side test vector; not written to the file)
 *
 * Output: seed/students.json — the roster the registrar issues from and the
 * gate node verifies against. See seed/README.md. The client app does NOT
 * bundle this; each phone stores only its own credential.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_STUDENT_ID,
  PAYLOAD_BITS,
  TIME_STEP_MS,
  formatCode,
  generateToken,
} from '../src/services/tokenGenerator.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'seed', 'students.json');

/* -- CLI ----------------------------------------------------------------- */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const FORCE = has('--force');
const VECTORS = has('--vectors');
const SHOW = has('--show');
const COUNT = val('--count', null);

const pad = (s, w) => String(s).padEnd(w);

/** Print the roster, and (if --vectors) each student's current rolling code. */
function report(list) {
  console.log(pad('studentId', 11) + pad('section', 10) + 'name');
  console.log('-'.repeat(60));
  for (const s of list) {
    console.log(pad(s.studentId, 11) + pad(s.section ?? '', 10) + s.name);
  }
  if (VECTORS) {
    console.log('\ncurrent rolling codes (valid ~15s — live gate test vectors):');
    console.log(pad('studentId', 11) + pad('counter', 14) + 'code (6-digit)');
    console.log('-'.repeat(50));
    const now = Date.now();
    for (const s of list) {
      const t = generateToken(s.secret, s.studentId, now);
      console.log(pad(s.studentId, 11) + pad(t.counter, 14) + formatCode(t.rollingCode));
    }
  }
}

/* -- read-only view of the existing file ------------------------------------ */

if (SHOW) {
  if (!existsSync(OUT)) {
    console.error(`no seed yet at ${OUT} — run: npm run seed`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(OUT, 'utf8'));
  console.log(`${OUT}\ngenerated ${doc.generatedAt} · ${doc.students.length} students\n`);
  report(doc.students);
  process.exit(0);
}

/* -- roster source ----------------------------------------------------------
 * Names below are the capstone team, reused as sample students. Section codes
 * follow QCU BSIT conventions. Student numbers are 6 digits (fit the 20-bit
 * payload field, max 1_048_575).
 * --------------------------------------------------------------------------- */

const BASE = [
  { name: 'Jumuad, Samantha Queen C.', program: 'BSIT', section: 'SBIT4K' },
  { name: 'Reyes, John Kenny Q.', program: 'BSIT', section: 'SBIT4K' },
  { name: 'Añonuevo, Jhon Andrew', program: 'BSIT', section: 'SBIT4K' },
  { name: 'Dela Cruz, Juan Carlo', program: 'BSIT', section: 'SBIT4K' },
  { name: 'Sebial, John Errol', program: 'BSIT', section: 'SBIT4K' },
  { name: 'Alaña, Nicole', program: 'BSIT', section: 'SBIT4L' },
  { name: 'Añonuevo, Balili Erica Mea', program: 'BSIT', section: 'SBIT4L' },
  { name: 'Belardo, Iris Angelo A.', program: 'BSIT', section: 'SBIT4L' },
  { name: 'Comawas, Rj', program: 'BSIT', section: 'SBIT4L' },
  { name: 'Magpantay, Zyrill', program: 'BSIT', section: 'SBIT4M' },
  { name: 'Suico, Wiljohn', program: 'BSIT', section: 'SBIT4M' },
  { name: 'Santos, Maria Clara', program: 'BSIT', section: 'SBIT4M' },
];

/* -- helpers ----------------------------------------------------------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding) of `bytes`. */
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 160-bit secret, 32 base32 chars. */
const newSecret = () => base32(randomBytes(20));

/* -- build ----------------------------------------------------------------- */

if (existsSync(OUT) && !FORCE) {
  console.error(
    `refusing to overwrite ${OUT}\n` +
      'pass --force to regenerate (this rotates every secret and breaks any device already enrolled against the old file)',
  );
  process.exit(1);
}

const n = COUNT ? Math.max(1, Math.min(Number(COUNT), 900)) : BASE.length;
const students = [];
for (let i = 0; i < n; i++) {
  const src = BASE[i % BASE.length];
  const studentId = 231800 + i; // stays well under MAX_STUDENT_ID
  if (studentId > MAX_STUDENT_ID) throw new Error('studentId overflow');
  students.push({
    studentId,
    name: i < BASE.length ? src.name : `${src.name} (${i})`,
    program: src.program,
    section: src.section,
    status: 'active',
    secret: newSecret(),
    deviceEnrolled: false,
  });
}

const doc = {
  $comment:
    'SAMPLE DATA — not for production. Regenerate with `npm run seed -- --force`.',
  generatedAt: new Date().toISOString(),
  protocol: {
    timeStepMs: TIME_STEP_MS,
    payloadBits: PAYLOAD_BITS,
    hotp: 'HMAC-SHA1 / RFC 4226 dynamic truncation, key = secret as raw UTF-8',
  },
  students,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

/* -- report -------------------------------------------------------------- */

console.log(`wrote ${students.length} students -> ${OUT}\n`);
report(students);
