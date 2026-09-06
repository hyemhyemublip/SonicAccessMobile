/**
 * Tiny hand-rolled validation. Throws `HttpError(400, ...)` on bad input;
 * the app error handler turns that into a JSON 400.
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => {
  throw new HttpError(400, msg);
};

// The studentId payload field is 20 bits (see src/PROTOCOL.md §3).
export const MAX_STUDENT_ID = (1 << 20) - 1; // 1_048_575

export function studentId(v, field = 'studentId') {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 0 || n > MAX_STUDENT_ID) {
    bad(`${field} must be an integer 0..${MAX_STUDENT_ID}`);
  }
  return n;
}

export function str(v, field, { min = 1, max = 512 } = {}) {
  if (typeof v !== 'string') bad(`${field} must be a string`);
  const s = v.trim();
  if (s.length < min) bad(`${field} must be at least ${min} char(s)`);
  if (s.length > max) bad(`${field} must be at most ${max} chars`);
  return s;
}

export function optStr(v, field, opts) {
  if (v === undefined || v === null || v === '') return null;
  return str(v, field, opts);
}

export function oneOf(v, field, allowed) {
  if (!allowed.includes(v)) bad(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

export function isoTimestamp(v, field) {
  if (typeof v !== 'string') bad(`${field} must be an ISO 8601 string`);
  const t = Date.parse(v);
  if (Number.isNaN(t)) bad(`${field} is not a valid timestamp`);
  return new Date(t).toISOString();
}

export function optInt(v, field) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v)) bad(`${field} must be an integer`);
  return v;
}
