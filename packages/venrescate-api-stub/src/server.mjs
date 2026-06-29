#!/usr/bin/env node
// venrescate-api-stub: zero-dependency API seam server serving real signed records
// from test vectors, with coordinator reply signing and WebSocket push.

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, '..', '..', '..', 'test-vectors');
const PORT = parseInt(process.env.PORT || '3001');

function load(name) {
  return JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));
}
const keysData = load('keys.json');
const cryptoVectors = load('crypto-vectors.json');
const foldVectors = load('fold-vectors.json');

// Ed25519 utilities (mirrors venrescate-core-ts).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function keyFromSeed(seedHex) {
  const seed = Buffer.from(seedHex, 'hex');
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const rawPub = pubDer.subarray(-32);
  return { priv, pubRaw: rawPub, pub: Buffer.from(rawPub).toString('base64url') };
}
function sign(msgBytes, priv) {
  const sig = crypto.sign(null, msgBytes, priv);
  return Buffer.from(sig).toString('base64url');
}
function verify(msgBytes, sigB64u, pubRaw) {
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, pubRaw]), format: 'der', type: 'spki' });
  return crypto.verify(null, msgBytes, pub, Buffer.from(sigB64u, 'base64url'));
}
function contentHash(msg) { return crypto.createHash('sha256').update(msg).digest('hex'); }

// Canonical JSON (mirrors gen-vectors.js exactly).
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

const identities = {};
for (const [name, k] of Object.entries(keysData)) {
  const id = keyFromSeed(k.seed_hex);
  identities[name] = { ...id, ...k, name };
}

const pubRawById = {};
for (const [, id] of Object.entries(identities)) {
  pubRawById[id.device_id] = id.pubRaw;
}

const records = new Map();
const attestationsByReport = new Map();

function addRecord(record) {
  records.set(record.id, record);
  if (record.kind === 'attestation' && record.target_report_id) {
    if (!attestationsByReport.has(record.target_report_id)) {
      attestationsByReport.set(record.target_report_id, []);
    }
    attestationsByReport.get(record.target_report_id).push(record);
  }
}

const sosAlice = cryptoVectors.cases[0].record;
addRecord({ ...sosAlice, _received_at: Date.now(), _reach: 'bridged' });

for (const sc of foldVectors.scenarios) {
  if (!records.has(sc.report.id)) {
    addRecord({ ...sc.report, _received_at: Date.now(), _reach: 'bridged' });
  }
  for (const att of sc.attestations) {
    if (!records.has(att.id)) {
      addRecord({ ...att, _received_at: Date.now(), _reach: 'bridged' });
    }
  }
}

const TIER = { reported: 1, corroborated: 2, on_site: 3, device_confirmed: 4, self_confirmed: 5 };
const REV_TIER = {};
for (const [k, v] of Object.entries(TIER)) REV_TIER[v] = k;

function fold(report, attestations, subjectDeviceId) {
  if (!pubRawById[report.author_id] || !verifyRecord(report, pubRawById[report.author_id])) {
    return { tier: 0, tierName: 'invalid', verified: false, disputed: false, locationVerified: false };
  }
  const valid = attestations.filter(a => pubRawById[a.claimer_id || a.author_id] && verifyRecord(a, pubRawById[a.claimer_id || a.author_id]));

  let tier = TIER.reported, locationVerified = false;
  const reporter = report.author_id;

  const verified = valid.some(a => (a.claimer_id || a.author_id) === reporter && ['affirm', 'resolve'].includes(a.att_type || a.type));

  const corroborators = new Set(valid.filter(a =>
    (a.claimer_id || a.author_id) !== reporter &&
    ['corroborate', 'on_site', 'device_confirm'].includes(a.att_type || a.type) &&
    a.fact === 'still_needs_help'
  ).map(a => a.claimer_id || a.author_id));
  if (corroborators.size >= 2) tier = Math.max(tier, TIER.corroborated);

  if (valid.some(a => (a.att_type || a.type) === 'on_site' && a.proof && a.proof.match === true)) tier = Math.max(tier, TIER.on_site);

  const dcs = valid.filter(a => (a.att_type || a.type) === 'device_confirm' && a.proof && a.proof.subject_sig);
  for (const a of dcs) {
    const proof = a.proof;
    const rp = proof.response_payload;
    if (!rp) continue;
    const spub = subjectDeviceId ? pubRawById[subjectDeviceId] : null;
    const subjectSig = proof.subject_sig;
    const payloadMsg = Buffer.from(canon(rp), 'utf8');
    const subjOk = spub && verify(payloadMsg, subjectSig, spub) &&
      rp.subject_id === subjectDeviceId &&
      rp.attestor_id === (a.claimer_id || a.author_id);
    if (!subjOk) continue;
    const ownCode = proof.own_plus_code8 || '';
    const attCode = rp.attestor_plus_code || '';
    const subjectAnchored = attCode && attCode === ownCode;
    const sameCell = new Set(dcs.filter(x => (x.proof.own_plus_code8 || '') === ownCode).map(x => x.claimer_id || x.author_id));
    if (subjectAnchored || sameCell.size >= 2) { tier = Math.max(tier, TIER.device_confirmed); locationVerified = true; }
    else { tier = Math.max(tier, TIER.on_site); locationVerified = false; }
  }

  if (subjectDeviceId && valid.some(a => (a.att_type || a.type) === 'self_confirm' && (a.claimer_id || a.author_id) === subjectDeviceId)) {
    tier = Math.max(tier, TIER.self_confirmed); locationVerified = true;
  }

  const facts = new Set(valid.filter(a => ['on_site', 'corroborate', 'resolve'].includes(a.att_type || a.type)).map(a => a.fact));
  const disputed = facts.has('still_needs_help') && (facts.has('found_safe') || facts.has('false'));

  return { tier, tierName: REV_TIER[tier] || 'reported', verified, disputed, locationVerified: locationVerified };
}

function verifyRecord(rec, pubRaw) {
  // sig, content_hash and all server-side metadata (origin/_reach/_received_at)
  // are NOT part of the signed bytes.
  const { sig, content_hash, _received_at, _reach, origin, ...noSig } = rec;
  const msg = Buffer.from(canon(noSig), 'utf8');
  return verify(msg, sig, pubRaw);
}

function recordMeta(rec) {
  const atts = attestationsByReport.get(rec.id) || [];
  const subjectId = rec.subject_id || null;
  const { _received_at, _reach, ...clean } = rec;
  return {
    record: clean,
    meta: {
      reach: { level: rec._reach || 'bridged' },
      ...fold(rec, atts, subjectId),
      origin: rec.origin || null,
      received_at: new Date(rec._received_at || Date.now()).toISOString(),
    }
  };
}

const wsClients = new Set();

const coordinators = new Set();

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  for (const ws of wsClients) {
    try { ws.send(msg); } catch {}
  }
}

// Coordinator key, hardcoded for stub; real = OS-encrypted.
const coordinator = keyFromSeed('aa'.repeat(32));
const coordFingerprint = fingerprint(coordinator.pubRaw);
pubRawById[coordFingerprint] = coordinator.pubRaw; // Register so stub can verify coordinator signatures
console.log('Coordinator device_id:', coordFingerprint);

// Also register the integration test's coordinator key (same seed pattern)
const testCoord = keyFromSeed('aa'.repeat(32));
pubRawById[testCoord.device_id] = testCoord.pubRaw;

let coordinatorSeq = 0;

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/v1/records') {
      const kind = url.searchParams.get('kind');
      const prioMin = parseInt(url.searchParams.get('prio_min') || '0');
      const prioMax = parseInt(url.searchParams.get('prio_max') || '5');
      const limit = parseInt(url.searchParams.get('limit') || '50');

      let results = Array.from(records.values()).filter(r => {
        if (kind && r.kind !== kind) return false;
        if (r.prio != null && (r.prio < prioMin || r.prio > prioMax)) return false;
        return true;
      });

      results = results.slice(0, limit);
      return res.end(JSON.stringify(results.map(recordMeta)));
    }

    const recordMatch = path.match(/^\/v1\/records\/(.+)$/);
    if (req.method === 'GET' && recordMatch) {
      const rec = records.get(decodeURIComponent(recordMatch[1]));
      if (!rec) return res.writeHead(404).end(JSON.stringify({ error: 'not found or not bridged' }));
      const { _received_at, _reach, ...clean } = rec;
      const atts = (attestationsByReport.get(rec.id) || []).map(a => {
        const { _received_at: ar, _reach, ...c } = a;
        return {
          record: c,
          meta: { reach: { level: a._reach || 'bridged' }, origin: a.origin || null },
        };
      });
      const fresult = fold(rec, attestationsByReport.get(rec.id) || [], rec.subject_id || null);
      return res.end(JSON.stringify({
        record: clean,
        meta: {
          reach: { level: rec._reach || 'bridged' },
          ...fresult,
          origin: rec.origin || null,
          received_at: new Date(rec._received_at || Date.now()).toISOString(),
        },
        attestations: atts,
        fold: fresult,
      }));
    }

    const attMatch = path.match(/^\/v1\/records\/(.+)\/attestations$/);
    if (req.method === 'GET' && attMatch) {
      const atts = (attestationsByReport.get(decodeURIComponent(attMatch[1])) || []).map(a => {
        const { _received_at, _reach, ...clean } = a;
        return clean;
      });
      return res.end(JSON.stringify(atts.map(a => ({ record: a, meta: { reach: { level: 'bridged' } } }))));
    }

    if (req.method === 'POST' && path === '/v1/records') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const input = JSON.parse(body);

          // Signer is author_id (reports) or claimer_id (attestations).
          const signerId = input.author_id || input.claimer_id;
          let origin = input.origin;

          if (input.sig) {
            // Pre-signed: verify against the signer's registered key.
            const { sig, content_hash, _received_at, _reach, origin: _o, ...noSig } = input;
            const signerKey = pubRawById[signerId];
            if (signerKey) {
              const msg = Buffer.from(canon(noSig), 'utf8');
              if (!verify(msg, sig, signerKey)) {
                return res.writeHead(403).end(JSON.stringify({ error: 'invalid signature' }));
              }
            } else {
              // Unknown key — accept but tag lower-trust (online origin).
              origin = 'online';
            }
          } else {
            // No sig — stub signs on behalf (demo convenience).
            const { sig, content_hash, ...bodyToSign } = input;
            const msg = Buffer.from(canon(bodyToSign), 'utf8');
            input.sig = sign(msg, coordinator.priv);
            input.content_hash = contentHash(msg);
          }

          const record = {
            ...input,
            origin,
            _received_at: Date.now(),
            _reach: 'bridged',
          };
          addRecord(record);
          const meta = recordMeta(record);
          broadcast('record:created', meta);
          res.writeHead(201).end(JSON.stringify(meta));
        } catch (e) {
          res.writeHead(400).end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /v1/coordinators — register a coordinator public key so the fold can
    // verify its signatures. The device_id is RE-DERIVED from the key (anti-spoof).
    if (req.method === 'POST' && path === '/v1/coordinators') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { pub_b64u } = JSON.parse(body);
          const pubRaw = Buffer.from(pub_b64u, 'base64url');
          if (pubRaw.length !== 32) return res.writeHead(400).end(JSON.stringify({ error: 'pubkey must be 32 bytes' }));
          const deviceId = fingerprint(pubRaw);
          pubRawById[deviceId] = pubRaw;
          coordinators.add(deviceId);
          console.log('Registered coordinator:', deviceId);
          res.writeHead(200).end(JSON.stringify({ device_id: deviceId }));
        } catch (e) {
          res.writeHead(400).end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && path === '/v1/incidents') {
      const incidents = [];
      const cells = new Map();
      for (const rec of records.values()) {
        if (rec.kind !== 'report') continue;
        const plusCode = rec.payload?.plus_code || rec.payload?.plus_code8 || 'unknown';
        const cell = plusCode.substring(0, 8);
        const key = `${cell}:${rec.type}`;
        if (!cells.has(key)) {
          cells.set(key, { cell, type: rec.type, count: 0, maxTier: 0, maxReach: 'in_mesh', disputed: false, ids: [] });
        }
        const inc = cells.get(key);
        inc.count++;
        inc.ids.push(rec.id);
        const meta = recordMeta(rec);
        inc.maxTier = Math.max(inc.maxTier, meta.meta.tier);
        if (meta.meta.reach?.level === 'bridged') inc.maxReach = 'bridged';
        if (meta.meta.disputed) inc.disputed = true;
      }
      for (const inc of cells.values()) {
        incidents.push({
          id: `${inc.cell}:${inc.type}`,
          cell: inc.cell,
          type: inc.type,
          count: inc.count,
          maxTier: inc.maxTier,
          maxReach: inc.maxReach,
          disputed: inc.disputed,
        });
      }
      return res.end(JSON.stringify(incidents));
    }

    res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: e.message }));
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/v1/ws') {
    // Manual WebSocket upgrade (zero deps)
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    );

    const ws = { send: (data) => {
      const payload = Buffer.from(data, 'utf8');
      const frame = Buffer.alloc(2 + payload.length);
      frame[0] = 0x81; // FIN + text opcode
      frame[1] = payload.length;
      payload.copy(frame, 2);
      try { socket.write(frame); } catch {}
    }, close: () => socket.end() };

    wsClients.add(ws);
    ws.send(JSON.stringify({ event: 'connected', data: { total_records: records.size }, ts: Date.now() }));

    socket.on('data', (buf) => {
      if (buf[0] === 0x89) { /* ping - send pong */
        const pong = Buffer.alloc(2);
        pong[0] = 0x8A; pong[1] = 0;
        try { socket.write(pong); } catch {}
      }
    });

    socket.on('close', () => wsClients.delete(ws));
    socket.on('error', () => wsClients.delete(ws));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`\n🔵 VenRescate API stub running at http://localhost:${PORT}`);
  console.log(`   REST:  http://localhost:${PORT}/v1/records`);
  console.log(`   WS:    ws://localhost:${PORT}/v1/ws`);
  console.log(`   Incidents: http://localhost:${PORT}/v1/incidents`);
  console.log(`   Seeded ${records.size} records from test vectors\n`);
  console.log(`   Coordinator device_id: ${fingerprint(coordinator.pubRaw)}`);
});

function fingerprint(pubRaw) {
  const hash = crypto.createHash('sha256').update(pubRaw).digest();
  return Buffer.from(hash.subarray(0, 12)).toString('base64url');
}
