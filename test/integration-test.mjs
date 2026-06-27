#!/usr/bin/env node
// End-to-end test of the API seam: start the stub, query records, post + verify a signed coordinator reply.

import { spawn } from 'child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_DIR = join(__dirname, '..', 'packages', 'baran-api-stub');
const PORT = 3099; // non-conflicting port

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; return; }
  console.error(`  FAIL: ${msg}`);
  failed++;
}

function canon(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('non-integer: ' + v);
    return String(v);
  }
  return JSON.stringify(v);
}

const child = spawn('node', ['src/server.mjs'], {
  cwd: STUB_DIR,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});

const BASE = `http://localhost:${PORT}/v1`;

await new Promise((resolve) => {
  child.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('running')) setTimeout(resolve, 500);
  });
});

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

try {
  console.log('1. GET /records');
  const records = await get('/records?limit=50');
  assert(Array.isArray(records), 'records is an array');
  assert(records.length > 0, `records.length=${records.length} > 0`);

  const sos = records.find(r => r.record.type === 'sos');
  assert(!!sos, 'found SOS record');
  assert(sos.meta.tier >= 1, `SOS tier=${sos.meta.tier} >= 1`);
  assert(sos.meta.tierName !== 'invalid', `SOS tierName=${sos.meta.tierName} !== invalid`);
  assert(sos.meta.reach?.level === 'bridged', `SOS reach=${sos.meta.reach?.level} === bridged`);

  console.log(`   Found ${records.length} records, SOS tier=${sos.meta.tierName}`);

  console.log('2. GET /records/:id');
  const detail = await get(`/records/${sos.record.id}`);
  assert(detail.record, 'detail has record');
  assert(Array.isArray(detail.attestations), 'detail has attestations array');
  assert(detail.fold, 'detail has fold result');
  assert(typeof detail.fold.tier === 'number', 'fold.tier is a number');
  console.log(`   Record has ${detail.attestations.length} attestations, tier=${detail.fold.tierName}`);

  console.log('3. GET /incidents');
  const incidents = await get('/incidents');
  assert(Array.isArray(incidents), 'incidents is an array');
  assert(incidents.length > 0, 'incidents length > 0');
  console.log(`   ${incidents.length} incidents`);

  console.log('4. POST /records — coordinator reply');
  const coordSeedHex = 'aa'.repeat(32);
  const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
  const seed = Buffer.from(coordSeedHex, 'hex');
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const rawPub = pubDer.subarray(-32);
  const coordId = Buffer.from(createHash('sha256').update(rawPub).digest().subarray(0, 12)).toString('base64url');

  const statusReport = {
    schema_version: 1,
    kind: 'report',
    id: `${coordId}:1`,
    author_id: coordId,
    author_seq: 1,
    type: 'status',
    prio: 2,
    created_wall_ms: Date.now(),
    hlc: `${Date.now()}.0.${coordId}`,
    payload: { msg: 'equipo SAR en camino, ETA 45 min', plus_code: '77GR2J4C+9P' },
  };

  const canonicalStr = canon(statusReport);
  const msg = Buffer.from(canonicalStr, 'utf8');
  const sigBuf = sign(null, msg, priv);
  const contentHashVal = createHash('sha256').update(msg).digest('hex');
  const sigB64u = Buffer.from(sigBuf).toString('base64url');

  const signedReport = {
    ...statusReport,
    content_hash: contentHashVal,
    sig: sigB64u,
  };

  const postResult = await post('/records', signedReport);
  assert(postResult.status === 201, `POST status=${postResult.status} === 201`);
  assert(postResult.data?.record?.id === `${coordId}:1`, 'created record id matches');
  // Unknown keys get accepted but may be tagged lower-trust
  assert(postResult.data?.meta?.tier >= 0, 'coordinator report accepted');

  assert(postResult.data.record.content_hash === contentHashVal, 'server content_hash matches client-computed');
  console.log(`   Coordinator reply created: ${postResult.data.record.id}`);

  const { sig: _s, content_hash: _ch, ...bodyToVerify } = signedReport;
  const verifyResult = verify(
    null,
    Buffer.from(canon(bodyToVerify)),
    createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPub]), format: 'der', type: 'spki' }),
    Buffer.from(sigB64u, 'base64url')
  );
  assert(verifyResult === true, 'coordinator signature self-verifies');

  console.log('5. Verify roundtrip — re-fetch');
  const fetched = await get(`/records/${coordId}:1`);
  assert(fetched.record?.id === `${coordId}:1`, 're-fetched record exists');
  assert(fetched.record?.sig === sigB64u, 're-fetched signature matches');
  console.log(`   Roundtrip verified: ${fetched.record.id} tier=${fetched.meta?.tierName}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('INTEGRATION TEST FAILED');
    process.exitCode = 1;
  } else {
    console.log('ALL INTEGRATION TESTS PASS');
  }
} catch(e) {
  console.error('Test error:', e);
  process.exitCode = 1;
} finally {
  child.kill();
  process.exit(process.exitCode || 0);
}
