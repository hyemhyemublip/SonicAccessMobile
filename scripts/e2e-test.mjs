/**
 * End-to-end integration test — the whole Phase 1 pipeline, no hardware.
 *
 *   node --experimental-strip-types --experimental-sqlite scripts/e2e-test.mjs
 *   npm run test:e2e
 *
 * Flow:
 *   backend (ephemeral port, temp DB)
 *     <- POST /admin/students        provision a student + secret
 *   client: generateToken -> buildWaveform -> encodeWav        (a real chirp WAV)
 *   node:  decodeWav -> CRC -> GET /nodes/secrets -> verifyToken
 *          -> POST /ingest/events
 *   assert: occupancy moves +1 / -1, replay is deduped, floor at 0,
 *           /occupancy + /occupancy/events reflect it.
 *
 * This is the "every layer agrees" check: modulator, reference decoder, wire
 * format, and backend ingest/occupancy in one run.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env must be set before the backend module is imported (db.mjs opens on load)
const DB = join(tmpdir(), `sa-e2e-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB;
process.env.ADMIN_TOKEN = 'e2e-admin';
process.env.NODE_TOKEN = 'e2e-node';
process.env.READ_TOKEN = 'e2e-read';
process.env.PUBLIC_OCCUPANCY = 'false';
process.env.LOG_REQUESTS = 'false';

const { createApp } = await import('../server/src/app.mjs');
const { generateToken, verifyToken, counterFor } = await import(
  '../src/services/tokenGenerator.ts'
);
const { buildWaveform, encodeWav, DEFAULT_CHIRP } = await import(
  '../src/utils/audioSynthesizer.ts'
);
const { decodeWav } = await import('./fsk-decoder.mjs');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.log('FAIL:', msg);
    fails++;
  }
};

const STUDENT_ID = 512345;
const SECRET = 'e2e-shared-secret-xyz-123';

/* -- boot the backend --------------------------------------------------- */

const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://localhost:${server.address().port}`;

const call = (path, { token, method = 'GET', body } = {}) =>
  fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const cleanup = () => {
  server.close();
  for (const ext of ['', '-wal', '-shm']) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
};

/* -- helper: emit one chirp and drive it through the node pipeline ---- */

/** Mirrors the ESP32 / gate-sim path: WAV -> decode -> verify -> ingest. */
async function tapGate(gateId, direction) {
  const now = Date.now();
  const token = generateToken(SECRET, STUDENT_ID, now);
  const wav = encodeWav(buildWaveform(token.bits, DEFAULT_CHIRP).samples, DEFAULT_CHIRP.sampleRate);

  const dec = decodeWav(Buffer.from(wav));
  ok(dec.ok, `${gateId}: decoder locked`);
  ok(dec.crcOk, `${gateId}: CRC ok`);
  ok(dec.studentId === STUDENT_ID, `${gateId}: decoded studentId`);

  // node re-derives from the map it pulled from the backend
  const map = await (await call('/nodes/secrets', { token: 'e2e-node' })).json();
  const fromMap = map.students.find((s) => s.studentId === STUDENT_ID)?.secret;
  ok(fromMap === SECRET, `${gateId}: /nodes/secrets carries our secret`);

  const v = verifyToken(fromMap, dec.bits, now, 1);
  ok(v.ok, `${gateId}: verifyToken accepts (${v.reason ?? 'ok'})`);

  const counter = counterFor(now) + (v.matchedDrift || 0);
  const res = await (
    await call('/ingest/events', {
      token: 'e2e-node',
      method: 'POST',
      body: {
        studentId: STUDENT_ID,
        gateId,
        direction,
        eventTs: new Date(now).toISOString(),
        counter,
      },
    })
  ).json();
  return { res, counter, now };
}

/* -- the test ---------------------------------------------------------- */

try {
  // provision
  const prov = await call('/admin/students', {
    token: 'e2e-admin',
    method: 'POST',
    body: { studentId: STUDENT_ID, name: 'E2E Student', section: 'E2E', secret: SECRET },
  });
  ok(prov.status === 201, 'provision -> 201');

  // ENTRY
  const entry = await tapGate('e2e-in', 'in');
  ok(entry.res.recorded === true, 'entry recorded');
  ok(entry.res.occupancy === 1, `entry occupancy = 1 (got ${entry.res.occupancy})`);

  // REPLAY of the exact same event (same gate + counter)
  const replay = await (
    await call('/ingest/events', {
      token: 'e2e-node',
      method: 'POST',
      body: {
        studentId: STUDENT_ID,
        gateId: 'e2e-in',
        direction: 'in',
        eventTs: new Date(entry.now).toISOString(),
        counter: entry.counter,
      },
    })
  ).json();
  ok(replay.duplicate === true, 'replay flagged duplicate');
  ok(replay.occupancy === 1, `replay does not move count (got ${replay.occupancy})`);

  // EXIT
  const exit = await tapGate('e2e-out', 'out');
  ok(exit.res.occupancy === 0, `exit occupancy = 0 (got ${exit.res.occupancy})`);

  // FLOOR: a second exit must not go negative
  const exit2 = await tapGate('e2e-out2', 'out');
  ok(exit2.res.occupancy === 0, `count floored at 0 (got ${exit2.res.occupancy})`);

  // occupancy read
  const occ = await (await call('/occupancy', { token: 'e2e-read' })).json();
  ok(occ.count === 0, `GET /occupancy count = 0 (got ${occ.count})`);
  ok(occ.today.in >= 1 && occ.today.out >= 2, `today counts (in ${occ.today.in}, out ${occ.today.out})`);

  // event log
  const ev = await (await call('/occupancy/events?limit=10', { token: 'e2e-read' })).json();
  ok(ev.events.length >= 3, `event log has >= 3 rows (got ${ev.events.length})`);
  ok(ev.events[0].id > ev.events[1].id, 'events newest-first');
  ok(
    ev.events.every((e) => e.studentId === STUDENT_ID),
    'all events are our student',
  );

  // negative: wrong secret is rejected at verify
  const bogus = generateToken(SECRET, STUDENT_ID);
  const bad = verifyToken('not-the-secret', bogus.bits, Date.now(), 1);
  ok(!bad.ok && bad.reason === 'code', 'wrong secret -> verify reject (code)');

  // negative: a tampered chirp fails CRC at decode
  const t = generateToken(SECRET, STUDENT_ID);
  const tb = t.bits.slice();
  tb[9] ^= 1;
  const tamperDec = decodeWav(
    Buffer.from(encodeWav(buildWaveform(tb, DEFAULT_CHIRP).samples, DEFAULT_CHIRP.sampleRate)),
  );
  ok(tamperDec.ok && !tamperDec.crcOk, 'tampered chirp -> CRC fail at decode');
} catch (err) {
  console.log('FAIL: threw', err?.stack || err);
  fails++;
} finally {
  cleanup();
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
