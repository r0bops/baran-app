// Adversarial tests for the real backend: auth bypass, token forgery/expiry,
// challenge-nonce replay, identity spoofing, bridge-receipt forgery, and write
// replay. An attacker must never gain write access or fake reach.
import { spawn } from 'child_process';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { keyFromSeed, sign as signRecord, signPayload, canon, base64urlDecode } from '../../baran-core-ts/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'src', 'server.mjs');
const PORT = 3096;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'sec-test-secret';

const dataDir = mkdtempSync(join(tmpdir(), 'baran-sec-'));
const coord = keyFromSeed('cc'.repeat(32));
const mallory = keyFromSeed('ee'.repeat(32));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.error('  FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [SERVER], {
  env: { ...process.env, PORT: String(PORT), BARAN_DATA: join(dataDir, 'r.jsonl'), BARAN_AUTH_SECRET: SECRET },
  stdio: 'ignore',
});
async function waitUp() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${BASE}/v1/bridge-key`); if (r.ok) return r.json(); } catch {} await sleep(150); }
  throw new Error('server did not start');
}
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function statusReply(id, seq, target) {
  const t = 1_750_000_000_000;
  const b = { schema_version: 1, kind: 'report', id: `${id.deviceId}:${seq}`, author_id: id.deviceId, author_seq: seq, type: 'status', prio: 2, created_wall_ms: t, hlc: `${t}.0.${id.deviceId}`, payload: { msg: 'reply', refs: [target] } };
  const s = signRecord(b, id);
  return { ...b, content_hash: s.contentHash, sig: s.sig };
}
function forgeToken(claims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

try {
  const bridgeKey = await waitUp();
  console.log('Baran adversarial security suite (server)\n');
  const sos = (await (await fetch(`${BASE}/v1/records?kind=report`)).json()).find((r) => r.record.type === 'sos');

  console.log('1. Write without a token is rejected');
  ok((await post('/v1/records', statusReply(coord, 1, sos.record.id))).status === 401, 'no token → 401');

  console.log('2. Forged / tampered / expired tokens are rejected');
  ok((await post('/v1/records', statusReply(coord, 2, sos.record.id), 'not.a.token')).status === 401, 'garbage token → 401');
  const badMac = forgeToken({ sub: coord.deviceId, role: 'coordinator', exp: Date.now() + 1e6 }).split('.')[0] + '.deadbeef';
  ok((await post('/v1/records', statusReply(coord, 3, sos.record.id), badMac)).status === 401, 'bad HMAC → 401');
  const expired = forgeToken({ sub: coord.deviceId, role: 'coordinator', exp: Date.now() - 1000 });
  ok((await post('/v1/records', statusReply(coord, 4, sos.record.id), expired)).status === 401, 'expired token → 401');

  console.log('3. Privilege escalation by editing token claims fails (HMAC binds them)');
  // take a real coordinator token, flip role→admin in the payload, keep old mac
  const realToken = await authToken(coord);
  const [p] = realToken.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  claims.role = 'admin';
  const tamperedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const escalated = `${tamperedPayload}.${realToken.split('.')[1]}`;
  ok((await fetch(`${BASE}/v1/exports`, { headers: { Authorization: `Bearer ${escalated}` } })).status === 403, 'tampered-claims token does not grant admin');

  console.log('4. Challenge nonce is single-use (no replay)');
  const ch = await (await fetch(`${BASE}/v1/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: coord.deviceId }) })).json();
  const sig = signPayload({ device_id: coord.deviceId, nonce: ch.nonce }, coord);
  const first = await post('/v1/auth/verify', { device_id: coord.deviceId, pub_b64u: coord.publicKeyB64u, sig });
  ok(first.status === 200, 'first verify ok');
  const replay = await post('/v1/auth/verify', { device_id: coord.deviceId, pub_b64u: coord.publicKeyB64u, sig });
  ok(replay.status === 401, 'replayed nonce → 401');

  console.log('5. device_id must match the presented key (anti-spoof)');
  const ch2 = await (await fetch(`${BASE}/v1/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: coord.deviceId }) })).json();
  const sig2 = signPayload({ device_id: coord.deviceId, nonce: ch2.nonce }, coord);
  // claim coord's id but present mallory's key
  const spoof = await post('/v1/auth/verify', { device_id: coord.deviceId, pub_b64u: mallory.publicKeyB64u, sig: sig2 });
  ok(spoof.status === 401, 'device_id ≠ fingerprint(pubkey) → 401');

  console.log('6. Cannot author as another identity, and tampered bodies are rejected');
  const token = await authToken(coord);
  const asMallory = statusReply(mallory, 1, sos.record.id); // signed by mallory, posted with coord's token
  ok((await post('/v1/records', asMallory, token)).status === 403, 'author_id ≠ token.sub → 403');
  const tampered = statusReply(coord, 7, sos.record.id);
  tampered.payload = { msg: 'TAMPERED', refs: [sos.record.id] }; // body changed after signing
  ok((await post('/v1/records', tampered, token)).status === 403, 'tampered body (sig mismatch) → 403');

  console.log('7. Bridge receipts only count under the PINNED key');
  const detail = await (await fetch(`${BASE}/v1/records/${encodeURIComponent(sos.record.id)}`)).json();
  const { sig: rsig, timestamp, ...rbody } = detail.bridge_receipt;
  const pinnedPub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(base64urlDecode(bridgeKey.pub_b64u))]), format: 'der', type: 'spki' });
  ok(crypto.verify(null, Buffer.from(canon(rbody), 'utf8'), pinnedPub, Buffer.from(base64urlDecode(rsig))), 'genuine receipt verifies under pinned key');
  const forgedReceipt = { ...rbody, bridge_id: mallory.deviceId };
  const forgedSig = signPayload(forgedReceipt, mallory);
  ok(!crypto.verify(null, Buffer.from(canon(forgedReceipt), 'utf8'), pinnedPub, Buffer.from(base64urlDecode(forgedSig))), 'mallory-signed receipt does NOT verify under pinned key');

  console.log('8. Replaying an accepted write is idempotent');
  const before = (await (await fetch(`${BASE}/v1/records?limit=500`)).json()).length;
  const rec = statusReply(coord, 50, sos.record.id);
  ok((await post('/v1/records', rec, token)).status === 201, 'first post accepted');
  await post('/v1/records', rec, token); // exact replay
  const after = (await (await fetch(`${BASE}/v1/records?limit=500`)).json()).length;
  ok(after === before + 1, `replay added no duplicate (${before} → ${after})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? 'ALL SECURITY TESTS PASS — server' : 'SECURITY TESTS FAILED');
} finally {
  srv.kill();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
}

async function authToken(id) {
  const ch = await (await fetch(`${BASE}/v1/auth/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: id.deviceId }) })).json();
  const sig = signPayload({ device_id: id.deviceId, nonce: ch.nonce }, id);
  const r = await (await fetch(`${BASE}/v1/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: id.deviceId, pub_b64u: id.publicKeyB64u, sig }) })).json();
  return r.token;
}

process.exit(failed === 0 ? 0 : 1);
