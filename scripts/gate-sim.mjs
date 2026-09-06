/**
 * Gate node simulator — the ESP32's job, on a laptop.
 *
 *   node --experimental-strip-types scripts/gate-sim.mjs [options] [file.wav]
 *   npm run gate-sim -- [options] [file.wav]
 *
 * Pipeline (mirrors src/PROTOCOL.md + BACKEND.md):
 *   WAV -> decodeWav -> CRC -> look up secret (pulled from the backend) ->
 *   verifyToken (rolling window +/- drift) -> replay cache ->
 *   POST /ingest/events  (in -> occupancy +1, out -> -1)
 *
 * Run two instances to demo entry + exit:
 *   npm run gate-sim -- --gate-id gate-entry --direction in  --port 5001
 *   npm run gate-sim -- --gate-id gate-exit  --direction out --port 5002
 *
 * Feed it audio by:
 *   - one-shot:  npm run gate-sim -- rec.wav
 *   - HTTP:      curl --data-binary @rec.wav localhost:5001/decode
 *   - watch dir: npm run gate-sim -- --watch ./inbox   (new *.wav are processed)
 *
 * No native deps: WAV files only (no live mic capture). Record with anything
 * (Audacity, arecord, a phone voice memo exported to WAV).
 */

import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, join } from 'node:path';
import { createServer } from 'node:http';

import { decodeWav } from './fsk-decoder.mjs';
import {
  counterFor,
  formatCode,
  verifyToken,
} from '../src/services/tokenGenerator.ts';

/* -- config ------------------------------------------------------------- */

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (name) => args.includes(`--${name}`);

const CFG = {
  gateId: String(flag('gate-id', 'gate-sim')),
  direction: String(flag('direction', 'in')),
  backend: String(flag('backend', process.env.BACKEND_URL || 'http://localhost:4000')).replace(/\/$/, ''),
  nodeToken: String(flag('node-token', process.env.NODE_TOKEN || '')),
  port: Number(flag('port', 5001)),
  pollSec: Number(flag('poll', 20)),
  driftSteps: Number(flag('drift', 1)),
  dedupeTtlSec: Number(flag('dedupe-ttl', 60)),
  ingest: !has('no-ingest'),
  watchDir: flag('watch', null),
  serve: !has('no-serve'),
};
const oneShotFile = args.find((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.wav'));

if (!['in', 'out'].includes(CFG.direction)) {
  console.error(`--direction must be "in" or "out"`);
  process.exit(2);
}
if (!CFG.nodeToken) {
  console.error('no NODE_TOKEN (env or --node-token). The backend needs it for /nodes/secrets and /ingest/events.');
  process.exit(2);
}

/* -- secret map cache (pulled from the backend) ----------------------- */

const secrets = new Map(); // studentId -> secret
let revoked = new Set(); // studentId
let revision = null;

async function pullSecrets() {
  const url = `${CFG.backend}/nodes/secrets?gateId=${encodeURIComponent(CFG.gateId)}&direction=${CFG.direction}`;
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${CFG.nodeToken}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = await r.json();
    secrets.clear();
    for (const s of doc.students) secrets.set(Number(s.studentId), s.secret);
    revoked = new Set((doc.revoked || []).map(Number));
    revision = doc.revision;
    log(`secret map: ${secrets.size} active, ${revoked.size} revoked (rev ${revision ?? '—'})`);
  } catch (err) {
    log(`WARN secret pull failed (${err.message}); keeping ${secrets.size} cached`);
  }
}

/* -- replay cache ---------------------------------------------------------- */

const seen = new Map(); // "studentId|counter" -> expiryMs

function replaySeen(studentId, counter) {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
  const key = `${studentId}|${counter}`;
  if (seen.has(key)) return true;
  seen.set(key, now + CFG.dedupeTtlSec * 1000);
  return false;
}

/* -- core: decode + verify + ingest ------------------------------------- */

async function processWav(bytes, label = 'wav') {
  let res;
  try {
    res = decodeWav(bytes);
  } catch (err) {
    return { accepted: false, reason: `parse:${err.message}` };
  }
  if (!res.ok) return { accepted: false, reason: res.reason };
  if (!res.crcOk) return { accepted: false, reason: 'crc', studentId: res.studentId };

  const secret = secrets.get(res.studentId);
  if (!secret) {
    return revoked.has(res.studentId)
      ? { accepted: false, reason: 'revoked', studentId: res.studentId }
      : { accepted: false, reason: 'unknown-student', studentId: res.studentId };
  }

  const now = Date.now();
  const v = verifyToken(secret, res.bits, now, CFG.driftSteps);
  if (!v.ok) return { accepted: false, reason: `verify:${v.reason}`, studentId: res.studentId };

  const counter = counterFor(now) + (v.matchedDrift || 0);
  if (replaySeen(res.studentId, counter)) {
    return { accepted: false, reason: 'replay', studentId: res.studentId, counter };
  }

  const out = {
    accepted: true,
    label,
    studentId: res.studentId,
    code: formatCode(res.rollingCode),
    counter,
    drift: v.matchedDrift || 0,
    direction: CFG.direction,
  };

  if (CFG.ingest) {
    try {
      const r = await fetch(`${CFG.backend}/ingest/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${CFG.nodeToken}`,
        },
        body: JSON.stringify({
          studentId: res.studentId,
          gateId: CFG.gateId,
          direction: CFG.direction,
          eventTs: new Date(now).toISOString(),
          counter,
        }),
      });
      const body = await r.json().catch(() => ({}));
      out.ingested = r.ok;
      out.occupancy = body.occupancy;
      out.duplicate = body.duplicate;
      if (!r.ok) out.ingestError = `HTTP ${r.status}: ${body.error || ''}`;
    } catch (err) {
      // a real node would queue and flush later; simulator just reports it
      out.ingested = false;
      out.ingestError = err.message;
    }
  }
  return out;
}

/* -- logging ------------------------------------------------------------ */

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${CFG.gateId}/${CFG.direction}  ${msg}`);
}
function report(r) {
  if (r.accepted) {
    const occ = r.occupancy != null ? ` occupancy=${r.occupancy}` : '';
    const dup = r.duplicate ? ' (duplicate)' : '';
    const ing = CFG.ingest ? (r.ingested ? ` ingested${occ}${dup}` : ` INGEST FAILED (${r.ingestError})`) : ' (no-ingest)';
    log(`ACCEPT student ${r.studentId} code ${r.code} counter ${r.counter} drift ${r.drift}${ing}`);
  } else {
    log(`REJECT ${r.reason}${r.studentId != null ? ` (student ${r.studentId})` : ''}`);
  }
}

/* -- runners ---------------------------------------------------------------- */

async function runOneShot(file) {
  const r = await processWav(await readFile(file), basename(file));
  report(r);
  process.exit(r.accepted ? 0 : 1);
}

function runWatch(dir) {
  const pending = new Set();
  log(`watching ${dir} for *.wav`);
  watch(dir, (_evt, name) => {
    if (!name || !name.toLowerCase().endsWith('.wav') || pending.has(name)) return;
    pending.add(name);
    // let the file finish being written
    setTimeout(async () => {
      pending.delete(name);
      try {
        const r = await processWav(await readFile(join(dir, name)), name);
        report(r);
      } catch (err) {
        log(`skip ${name}: ${err.message}`);
      }
    }, 400);
  });
}

function runServer() {
  const srv = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          gateId: CFG.gateId,
          direction: CFG.direction,
          backend: CFG.backend,
          secrets: secrets.size,
          revoked: revoked.size,
          revision,
        }),
      );
    }
    if (req.method === 'POST' && req.url === '/decode') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const r = await processWav(Buffer.concat(chunks), 'http');
        report(r);
        res.statusCode = r.accepted ? 200 : 422;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(r));
      });
      return;
    }
    res.statusCode = 404;
    res.end('POST /decode  (raw WAV body)  ·  GET /health\n');
  });
  srv.listen(CFG.port, () => log(`HTTP on :${CFG.port}  (POST /decode, GET /health)`));
}

/* -- main ------------------------------------------------------------------- */

log(`backend ${CFG.backend}  ingest=${CFG.ingest}  drift=${CFG.driftSteps}  replayTTL=${CFG.dedupeTtlSec}s`);
await pullSecrets();
setInterval(pullSecrets, Math.max(5, CFG.pollSec) * 1000).unref();

if (oneShotFile) {
  await runOneShot(oneShotFile);
} else {
  if (CFG.watchDir) runWatch(String(CFG.watchDir));
  if (CFG.serve) runServer();
  if (!CFG.watchDir && !CFG.serve) {
    log('nothing to do: pass a file.wav, --watch <dir>, or leave --no-serve off');
    process.exit(2);
  }
}
