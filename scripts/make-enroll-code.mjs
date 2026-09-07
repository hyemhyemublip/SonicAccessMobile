/**
 * Print enrollment codes for testing / a stand-in registrar.
 *
 *   npm run enroll-code -- 231800        one student from seed/students.json
 *   npm run enroll-code -- --all         every seeded student
 *   npm run enroll-code -- 512345 "S. Cruz" MYSECRETSTRING12345   ad-hoc
 *
 * The enrollment code is the **base64** string — paste it into the app's "Enter
 * the code manually" field, or turn it into a QR and scan. (The decoded JSON is
 * printed too, for reference; the parser accepts it as well.) Format matches
 * `src/services/enrollmentCode.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnrollPayload } from '../src/services/enrollmentCode.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', 'seed', 'students.json');

const args = process.argv.slice(2);

function emit(p) {
  const json = buildEnrollPayload(p);
  const b64 = Buffer.from(json).toString('base64');
  console.log(`\nstudent ${p.studentId}${p.name ? ` (${p.name})` : ''}`);
  console.log('  ENROLLMENT CODE (paste this / put in the QR):');
  console.log('    ' + b64);
  console.log('  (decoded, for reference: ' + json + ')');
}

// ad-hoc: <studentId> <name> <secret>  (3+ args, first is numeric)
if (args.length >= 3 && /^\d+$/.test(args[0])) {
  emit({ studentId: Number(args[0]), name: args[1] || undefined, secret: args[2] });
  process.exit(0);
}

const doc = JSON.parse(readFileSync(SEED, 'utf8'));
const students = doc.students ?? [];

if (args[0] === '--all') {
  for (const s of students) emit({ studentId: s.studentId, name: s.name, secret: s.secret });
} else if (/^\d+$/.test(args[0] ?? '')) {
  const s = students.find((x) => x.studentId === Number(args[0]));
  if (!s) {
    console.error(`studentId ${args[0]} not in ${SEED} — run: npm run seed -- --show`);
    process.exit(1);
  }
  emit({ studentId: s.studentId, name: s.name, secret: s.secret });
} else {
  console.error('usage: npm run enroll-code -- <studentId> | --all | <id> <name> <secret>');
  process.exit(2);
}
