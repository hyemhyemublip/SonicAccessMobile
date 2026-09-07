/**
 * Backend API tests. Run: `npm test` (from server/).
 *
 * Uses node:test + node:sqlite + a throwaway DB file. No external deps. Env is
 * set BEFORE importing the app so db.mjs opens the temp DB.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB = join(tmpdir(), `sa-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB;
process.env.ADMIN_TOKEN = 'a-tok';
process.env.NODE_TOKEN = 'n-tok';
process.env.READ_TOKEN = 'r-tok';
process.env.PUBLIC_OCCUPANCY = 'false';
process.env.LOG_REQUESTS = 'false';

const { createApp } = await import('../src/app.mjs');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  for (const ext of ['', '-wal', '-shm']) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

const req = (path, { token, method = 'GET', body, headers = {} } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const A = 'a-tok';
const N = 'n-tok';
const R = 'r-tok';

test('health is open', async () => {
  const r = await req('/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.rolesConfigured.sort(), ['admin', 'node', 'read']);
});

test('admin route rejects missing and wrong-role tokens', async () => {
  assert.equal((await req('/admin/students')).status, 401);
  assert.equal((await req('/admin/students', { token: R })).status, 401);
  assert.equal((await req('/admin/students', { token: A })).status, 200);
});

test('create student + set secret', async () => {
  const r = await req('/admin/students', {
    token: A,
    method: 'POST',
    body: { studentId: 500001, name: 'Test One', section: 'X', secret: 'secret-one-123' },
  });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.student.studentId, 500001);
  assert.equal(j.secretVersion, 1);
  assert.equal(j.student.secret, 'secret-one-123');
});

test('studentId out of 20-bit range is rejected', async () => {
  const r = await req('/admin/students', {
    token: A,
    method: 'POST',
    body: { studentId: 9_999_999, name: 'Too Big', secret: 'x'.repeat(10) },
  });
  assert.equal(r.status, 400);
});

test('nodes/secrets serves the map with an ETag, and 304s on If-None-Match', async () => {
  const r1 = await req('/nodes/secrets', { token: N });
  assert.equal(r1.status, 200);
  const etag = r1.headers.get('etag');
  assert.ok(etag);
  const j = await r1.json();
  assert.ok(j.students.some((s) => s.studentId === 500001 && s.secret === 'secret-one-123'));

  const r2 = await req('/nodes/secrets', { token: N, headers: { 'if-none-match': etag } });
  assert.equal(r2.status, 304);
});

test('ingest moves occupancy and dedupes on gateId|studentId|counter', async () => {
  const inEvt = {
    studentId: 500001,
    gateId: 'g-in',
    direction: 'in',
    eventTs: '2026-09-07T00:00:00Z',
    counter: 1000,
  };
  const a = await (await req('/ingest/events', { token: N, method: 'POST', body: inEvt })).json();
  assert.equal(a.recorded, true);
  assert.equal(a.occupancy, 1);

  const dup = await (await req('/ingest/events', { token: N, method: 'POST', body: inEvt })).json();
  assert.equal(dup.duplicate, true);
  assert.equal(dup.occupancy, 1);

  const out = await (
    await req('/ingest/events', {
      token: N,
      method: 'POST',
      body: { ...inEvt, gateId: 'g-out', direction: 'out', counter: 1001 },
    })
  ).json();
  assert.equal(out.occupancy, 0);

  // floor at zero
  const out2 = await (
    await req('/ingest/events', {
      token: N,
      method: 'POST',
      body: { ...inEvt, gateId: 'g-out', direction: 'out', counter: 1002 },
    })
  ).json();
  assert.equal(out2.occupancy, 0);
});

test('unknown student is still recorded', async () => {
  const j = await (
    await req('/ingest/events', {
      token: N,
      method: 'POST',
      body: { studentId: 424242, gateId: 'g-in', direction: 'in', eventTs: '2026-09-07T00:05:00Z', counter: 7 },
    })
  ).json();
  assert.equal(j.recorded, true);
  assert.equal(j.knownStudent, false);
});

test('occupancy read requires a token and reports today counts', async () => {
  assert.equal((await req('/occupancy')).status, 401);
  const j = await (await req('/occupancy', { token: R })).json();
  assert.equal(typeof j.count, 'number');
  assert.ok(j.today.in >= 2);
});

test('admin adjust and reset, with validation', async () => {
  const up = await (
    await req('/occupancy/adjust', { token: A, method: 'POST', body: { delta: 5, reason: 't' } })
  ).json();
  assert.equal(up.count, up.previous + 5);

  assert.equal(
    (await req('/occupancy/adjust', { token: A, method: 'POST', body: { delta: 0 } })).status,
    400,
  );
  assert.equal(
    (await req('/occupancy/reset', { token: A, method: 'POST', body: { to: -1 } })).status,
    400,
  );
  assert.equal(
    (await req('/occupancy/adjust', { token: R, method: 'POST', body: { delta: 1 } })).status,
    401,
  );

  const rs = await (
    await req('/occupancy/reset', { token: A, method: 'POST', body: { to: 0 } })
  ).json();
  assert.equal(rs.count, 0);

  const adj = await (await req('/occupancy/adjustments', { token: R })).json();
  assert.ok(adj.adjustments.length >= 2);
  assert.ok(adj.adjustments.some((a) => a.kind === 'reset'));
});

test('rotate issues a new version; revoke removes from the node map', async () => {
  const rot = await (
    await req('/admin/students/500001/rotate', { token: A, method: 'POST', body: {} })
  ).json();
  assert.equal(rot.secretVersion, 2);
  assert.ok(rot.secret.length >= 16);

  await req('/admin/students/500001/revoke', { token: A, method: 'POST', body: {} });
  const map = await (await req('/nodes/secrets', { token: N })).json();
  assert.ok(!map.students.some((s) => s.studentId === 500001));
  assert.ok(map.revoked.includes(500001));
});

test('GET /nodes lists checked-in gate nodes', async () => {
  const j = await (await req('/nodes', { token: R })).json();
  const ids = j.nodes.map((n) => n.gateId);
  assert.ok(ids.includes('g-in'));
  assert.ok(ids.includes('g-out'));
});

test('malformed JSON body -> 400', async () => {
  const r = await fetch(base + '/ingest/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${N}`, 'content-type': 'application/json' },
    body: '{nope',
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid JSON body');
});

test('dashboard is served at /', async () => {
  const r = await req('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /html/);
  assert.match(await r.text(), /Campus occupancy/);
});
