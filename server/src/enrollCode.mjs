/**
 * Build the enrollment code a student scans / pastes.
 *
 * MUST stay in sync with the client parser `src/services/enrollmentCode.ts`.
 * Object shape: { t:"sonicaccess/v1", sid, sec, nm? }. The code handed out is
 * the base64 of that JSON (paste-safe — no quotes for a phone keyboard to
 * mangle).
 */

export const ENROLL_PREFIX = 'sonicaccess/v1';

export function buildEnrollCode({ studentId, secret, name }) {
  const json = JSON.stringify({
    t: ENROLL_PREFIX,
    sid: studentId,
    sec: secret,
    ...(name ? { nm: name } : {}),
  });
  return { json, code: Buffer.from(json, 'utf8').toString('base64') };
}
