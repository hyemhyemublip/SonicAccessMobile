/**
 * Parse the enrollment payload the registrar hands out.
 *
 * The underlying object is:
 *   { "t": "sonicaccess/v1", "sid": <studentId>, "sec": "<secret>", "nm": "<name?>" }
 *
 * The **enrollment code** given to a student is the **base64** of that JSON —
 * it is what goes in the QR and what to paste into "Enter the code manually".
 * base64 has no quotes, so a phone keyboard can't mangle it. Raw JSON is also
 * accepted (and curly quotes / stray whitespace are repaired) but the base64
 * form is the canonical one.
 *
 * `/admin/students` provides `studentId` + `secret`; a small registrar tool
 * (see `scripts/make-enroll-code.mjs`) turns that into the code.
 *
 * Pilot note: the payload is not signed. Production should make it a one-time,
 * server-issued token so a leaked code can't be reused.
 */

import { Buffer } from 'buffer';

// The studentId payload field is 20 bits (see src/PROTOCOL.md §3).
const MAX_STUDENT_ID = (1 << 20) - 1; // 1_048_575

export interface EnrollPayload {
  studentId: number;
  secret: string;
  name?: string;
}

const PREFIX = 'sonicaccess/v1';

const SMART_DOUBLE = /[“”„‟″«»]/g;
const SMART_SINGLE = /[‘’‚‛′]/g;
const INVISIBLE = /[​‌‍﻿ ]/g;
const DASHES = /[–—]/g;

/** Undo the substitutions a phone keyboard makes when pasting / typing JSON. */
function deSmarten(s: string): string {
  return s
    .replace(SMART_DOUBLE, '"')
    .replace(SMART_SINGLE, "'")
    .replace(INVISIBLE, '')
    .replace(DASHES, '-');
}

export function parseEnrollPayload(raw: string): EnrollPayload {
  const text = deSmarten((raw ?? '').trim());
  if (!text) throw new Error('empty code');

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    try {
      // base64 form — strip any whitespace/newlines the paste inserted
      obj = JSON.parse(Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8'));
    } catch {
      throw new Error(
        'not a valid enrollment code — paste the whole code (the base64 form avoids quote problems)',
      );
    }
  }

  if (typeof obj !== 'object' || obj === null) throw new Error('not a valid enrollment code');
  const o = obj as Record<string, unknown>;

  if (o.t !== PREFIX) throw new Error('unrecognised enrollment code');

  const studentId =
    typeof o.sid === 'number'
      ? o.sid
      : typeof o.sid === 'string' && /^\d+$/.test(o.sid)
        ? Number(o.sid)
        : NaN;
  if (!Number.isInteger(studentId) || studentId < 0 || studentId > MAX_STUDENT_ID) {
    throw new Error('enrollment code has an invalid student ID');
  }

  const secret = typeof o.sec === 'string' ? o.sec.trim() : '';
  if (secret.length < 8) throw new Error('enrollment code has no usable secret');

  const name = typeof o.nm === 'string' && o.nm.trim() ? o.nm.trim().slice(0, 120) : undefined;

  return { studentId, secret, name };
}

/** Build a payload string (for a registrar tool / tests). */
export function buildEnrollPayload(p: EnrollPayload): string {
  return JSON.stringify({
    t: PREFIX,
    sid: p.studentId,
    sec: p.secret,
    ...(p.name ? { nm: p.name } : {}),
  });
}
