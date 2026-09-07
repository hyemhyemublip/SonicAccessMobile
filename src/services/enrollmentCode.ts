/**
 * Parse the enrollment payload the registrar hands out as a QR code (or a
 * pasted string). Format — a JSON object, optionally base64-encoded:
 *
 *   { "t": "sonicaccess/v1", "sid": <studentId>, "sec": "<secret>", "nm": "<name?>" }
 *
 * The `/admin/students` response gives `studentId` + `secret`; a small registrar
 * tool renders that (plus the name) as this payload.
 *
 * Pilot note: the payload is not signed. A production version should make it a
 * one-time, server-issued token so a leaked QR can't be reused.
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

export function parseEnrollPayload(raw: string): EnrollPayload {
  const text = (raw ?? '').trim();
  if (!text) throw new Error('empty code');

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    try {
      obj = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    } catch {
      throw new Error('not a valid enrollment code');
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
  return JSON.stringify({ t: PREFIX, sid: p.studentId, sec: p.secret, ...(p.name ? { nm: p.name } : {}) });
}
