// End-to-end test of the real API backend: auth, RBAC, signed writes, bridge receipts, fold, persistence.
import { spawn } from 'child_process';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  keyFromSeed,
  sign as signRecord,
  signPayload,
  canon,
  base64urlDecode,
} from '../../venrescate-core-ts/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'src', 'server.mjs');
const PORT = 3097;
const BASE = `http://localhost:${PORT}`;

const dataDir = mkdtempSync(join(tmpdir(), 'venrescate-srv-'));
const DATA = join(dataDir, 'records.jsonl');
const SECRET = 'test-secret-fixed';

const coord = keyFromSeed('cc'.repeat(32));
const admin = keyFromSeed('ad'.repeat(32));
const mallory = keyFromSeed('11'.repeat(32));

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  FAIL:', msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const p = spawn('node', [SERVER], {
    env: { ...process.env, PORT: String(PORT), VENRESCATE_DATA: DATA, VENRESCATE_AUTH_SECRET: SECRET, VENRESCATE_ADMINS: admin.deviceId },
    stdio: 'ignore',
  });
  return p;
}
async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/v1/bridge-key`); if (r.ok) return await r.json(); } catch {}
    await sleep(150);
  }
  throw new Error('server did not start');
}

async function authenticate(id) {
  const ch = await (await fetch(`${BASE}/v1/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: id.deviceId }) })).json();
  const sig = signPayload({ device_id: id.deviceId, nonce: ch.nonce }, id);
  const res = await fetch(`${BASE}/v1/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: id.deviceId, pub_b64u: id.publicKeyB64u, sig }) });
  return { status: res.status, body: await res.json() };
}

function buildStatusReply(id, target, msg) {
  const t = Date.now();
  const seq = Math.floor(Math.random() * 1e6);
  const body = { schema_version: 1, kind: 'report', id: `${id.deviceId}:${seq}`, author_id: id.deviceId, author_seq: seq, type: 'status', prio: 2, created_wall_ms: t, hlc: `${t}.0.${id.deviceId}`, payload: { msg, refs: [target] } };
  const { content_hash, sig } = signRecord(body, id);
  return { ...body, content_hash, sig };
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

try {
  let srv = startServer();
  const bridgeKey = await waitUp();
  console.log('VenRescate API server test\n');

  console.log('1. Seeded records are bridged + visible');
  const recs = await (await fetch(`${BASE}/v1/records?limit=100`)).json();
  ok(recs.length > 0, 'records returned');
  ok(recs.every((r) => r.meta.reach.level === 'bridged'), 'all visible records are bridged');
  const sos = recs.find((r) => r.record.type === 'sos');
  ok(sos && sos.meta.tier >= 1, 'SOS present with a tier');
  console.log(`   ${recs.length} records, SOS tier=${sos.meta.tierName}`);

  console.log('2. Bridge receipt verifies against pinned key');
  const detail = await (await fetch(`${BASE}/v1/records/${encodeURIComponent(sos.record.id)}`)).json();
  const rcpt = detail.bridge_receipt;
  ok(!!rcpt, 'has bridge receipt');
  const { sig: rsig, timestamp, ...rbody } = rcpt;
  const bridgePub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(base64urlDecode(bridgeKey.pub_b64u))]), format: 'der', type: 'spki' });
  const receiptValid = crypto.verify(null, Buffer.from(canon(rbody), 'utf8'), bridgePub, Buffer.from(base64urlDecode(rsig)));
  ok(receiptValid, 'bridge receipt signature valid under pinned key');
  console.log(`   pinned bridge=${bridgeKey.device_id} receipt valid=${receiptValid}`);

  console.log('3. Unauthenticated write is rejected (401)');
  const noAuth = await post('/v1/records', buildStatusReply(coord, sos.record.id, 'hola'));
  ok(noAuth.status === 401, `got ${noAuth.status} (expected 401)`);

  console.log('4. Coordinator authenticates via Ed25519 challenge-response');
  const coordAuth = await authenticate(coord);
  ok(coordAuth.status === 200 && coordAuth.body.token, 'coordinator got a token');
  ok(coordAuth.body.role === 'coordinator', `role=${coordAuth.body.role}`);
  const coordToken = coordAuth.body.token;

  console.log('5. Authenticated signed status reply is accepted');
  const reply = buildStatusReply(coord, sos.record.id, 'Equipo SAR en camino');
  const created = await post('/v1/records', reply, coordToken);
  ok(created.status === 201, `got ${created.status} (expected 201)`);
  ok(created.body.meta.reach.level === 'bridged', 'reply is bridged');
  ok(created.body.meta.origin === 'online', 'reply tagged origin:online');

  console.log('6. Cannot author as another identity (403)');
  const spoof = buildStatusReply(mallory, sos.record.id, 'spoof'); // signed by mallory, posted with coord token
  const spoofRes = await post('/v1/records', spoof, coordToken);
  ok(spoofRes.status === 403, `got ${spoofRes.status} (expected 403)`);

  console.log('7. Coordinator resolve attestation flows through the fold');
  const t = Date.now();
  const seq = 999001;
  const att = { schema_version: 1, kind: 'attestation', id: `${coord.deviceId}:a:${seq}`, claimer_id: coord.deviceId, claimer_seq: seq, target_report_id: sos.record.id, target_content_hash: sos.record.content_hash, att_type: 'resolve', fact: 'found_safe', prio: 0, created_wall_ms: t, hlc: `${t}.0.${coord.deviceId}` };
  const signed = (() => { const { content_hash, sig } = signRecord(att, coord); return { ...att, content_hash, sig }; })();
  const attRes = await post('/v1/records', signed, coordToken);
  ok(attRes.status === 201, `attestation accepted (${attRes.status})`);
  const after = await (await fetch(`${BASE}/v1/records/${encodeURIComponent(sos.record.id)}`)).json();
  ok(after.attestations.some((a) => a.record.att_type === 'resolve' && a.record.claimer_id === coord.deviceId), 'resolve appears in timeline');
  console.log(`   attestations now: ${after.attestations.length}, disputed=${after.fold.disputed}`);

  console.log('8. Export requires admin role');
  const coordExport = await fetch(`${BASE}/v1/exports`, { headers: { Authorization: `Bearer ${coordToken}` } });
  ok(coordExport.status === 403, `coordinator export forbidden (${coordExport.status})`);
  const adminAuth = await authenticate(admin);
  ok(adminAuth.body.role === 'admin', `admin role=${adminAuth.body.role}`);
  const adminExport = await fetch(`${BASE}/v1/exports`, { headers: { Authorization: `Bearer ${adminAuth.body.token}` } });
  ok(adminExport.status === 200, `admin export ok (${adminExport.status})`);
  const csv = await adminExport.text();
  ok(csv.includes('content_hash,sig') && csv.split('\n').length > 2, 'CSV has provenance columns + rows');

  console.log('9. Records persist across server restart');
  const countBefore = (await (await fetch(`${BASE}/v1/records?limit=200`)).json()).length;
  srv.kill();
  await sleep(400);
  srv = startServer();
  await waitUp();
  const countAfter = (await (await fetch(`${BASE}/v1/records?limit=200`)).json()).length;
  ok(countAfter === countBefore, `count ${countAfter} === ${countBefore} after restart`);
  const replyStill = await (await fetch(`${BASE}/v1/records/${encodeURIComponent(reply.id)}`)).json();
  ok(replyStill.record?.id === reply.id, 'coordinator reply survived restart');
  console.log(`   ${countAfter} records after restart (was ${countBefore})`);

  srv.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? 'ALL SERVER TESTS PASS' : 'SERVER TESTS FAILED');
} finally {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
