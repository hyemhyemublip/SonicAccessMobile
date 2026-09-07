/**
 * /admin — registrar / provisioning. Requires ADMIN_TOKEN.
 *
 *   POST   /admin/students                 upsert a student + set their active secret
 *                                          (body.secret optional -> auto-generated)
 *   GET    /admin/students                 list roster (?withSecrets=1 to include secrets)
 *   GET    /admin/students/:id             one student (?withSecret=1)
 *   GET    /admin/students/:id/enroll-code the base64 enrollment code + a QR data URL
 *   POST   /admin/students/:id/rotate      new secret version (body.secret optional)
 *   POST   /admin/students/:id/revoke      mark revoked, deactivate all secrets
 */

import { Router } from 'express';
import QRCode from 'qrcode';

import { db, tx, nowIso } from '../db.mjs';
import { newSecret } from '../secretgen.mjs';
import { buildEnrollCode } from '../enrollCode.mjs';
import { HttpError, optStr, str, studentId as vStudentId } from '../validate.mjs';

export const admin = Router();

const q = {
  getStudent: db.prepare('SELECT * FROM students WHERE student_id = ?'),
  upsertStudent: db.prepare(`
    INSERT INTO students (student_id, name, program, section, status, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?)
    ON CONFLICT(student_id) DO UPDATE SET
      name = excluded.name,
      program = excluded.program,
      section = excluded.section,
      status = 'active',
      updated_at = excluded.updated_at
  `),
  setStatus: db.prepare('UPDATE students SET status = ?, updated_at = ? WHERE student_id = ?'),
  maxVersion: db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM secrets WHERE student_id = ?'),
  deactivateSecrets: db.prepare('UPDATE secrets SET active = 0 WHERE student_id = ? AND active = 1'),
  insertSecret: db.prepare(
    'INSERT INTO secrets (student_id, version, secret, active, created_at) VALUES (?, ?, ?, 1, ?)',
  ),
  joined: db.prepare(`
    SELECT s.student_id, s.name, s.program, s.section, s.status, s.created_at, s.updated_at,
           sec.version AS secret_version, sec.secret AS secret
    FROM students s
    LEFT JOIN secrets sec ON sec.student_id = s.student_id AND sec.active = 1
    WHERE s.student_id = ?
  `),
  listJoined: db.prepare(`
    SELECT s.student_id, s.name, s.program, s.section, s.status, s.created_at, s.updated_at,
           sec.version AS secret_version, sec.secret AS secret
    FROM students s
    LEFT JOIN secrets sec ON sec.student_id = s.student_id AND sec.active = 1
    ORDER BY s.student_id
  `),
};

function shape(row, withSecret) {
  if (!row) return row;
  const out = {
    studentId: row.student_id,
    name: row.name,
    program: row.program,
    section: row.section,
    status: row.status,
    secretVersion: row.secret_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withSecret) out.secret = row.secret ?? null;
  return out;
}

/** Deactivate the current secret, write a new version. Returns the version. */
function rotateSecret(id, secret) {
  const version = q.maxVersion.get(id).v + 1;
  q.deactivateSecrets.run(id);
  q.insertSecret.run(id, version, secret, nowIso());
  return version;
}

const wantSecret = (v) => v === '1' || v === 'true';

admin.post('/students', (req, res) => {
  const b = req.body ?? {};
  const id = vStudentId(b.studentId);
  const name = str(b.name, 'name', { max: 200 });
  const program = optStr(b.program, 'program', { max: 64 });
  const section = optStr(b.section, 'section', { max: 64 });
  // secret optional — the registrar rarely wants to invent one
  const secret =
    b.secret == null || b.secret === ''
      ? newSecret()
      : str(b.secret, 'secret', { min: 8, max: 256 });

  const version = tx(() => {
    q.upsertStudent.run(id, name, program, section, nowIso());
    return rotateSecret(id, secret);
  });

  res.status(201).json({ student: shape(q.joined.get(id), true), secretVersion: version });
});

admin.get('/students/:id/enroll-code', async (req, res) => {
  const id = vStudentId(req.params.id, 'id');
  const row = q.joined.get(id);
  if (!row) throw new HttpError(404, 'student not found');
  if (row.status !== 'active' || !row.secret) {
    throw new HttpError(409, 'student has no active secret — issue or rotate one first');
  }
  const { code, json } = buildEnrollCode({ studentId: id, secret: row.secret, name: row.name });
  const qrDataUrl = await QRCode.toDataURL(code, { width: 256, margin: 1, errorCorrectionLevel: 'M' });
  res.json({ studentId: id, name: row.name, code, json, qrDataUrl });
});

admin.get('/students', (req, res) => {
  const withSecrets = wantSecret(req.query.withSecrets);
  const students = q.listJoined.all().map((r) => shape(r, withSecrets));
  res.json({ count: students.length, students });
});

admin.get('/students/:id', (req, res) => {
  const id = vStudentId(req.params.id, 'id');
  const row = q.joined.get(id);
  if (!row) throw new HttpError(404, 'student not found');
  res.json({ student: shape(row, wantSecret(req.query.withSecret)) });
});

admin.post('/students/:id/rotate', (req, res) => {
  const id = vStudentId(req.params.id, 'id');
  if (!q.getStudent.get(id)) throw new HttpError(404, 'student not found');
  const secret = req.body?.secret
    ? str(req.body.secret, 'secret', { min: 8, max: 256 })
    : newSecret();
  const version = tx(() => rotateSecret(id, secret));
  res.json({ studentId: id, secretVersion: version, secret });
});

admin.post('/students/:id/revoke', (req, res) => {
  const id = vStudentId(req.params.id, 'id');
  if (!q.getStudent.get(id)) throw new HttpError(404, 'student not found');
  tx(() => {
    q.setStatus.run('revoked', nowIso(), id);
    q.deactivateSecrets.run(id);
  });
  res.json({ studentId: id, status: 'revoked' });
});
