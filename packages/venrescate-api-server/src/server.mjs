#!/usr/bin/env node
// VenRescate real API backend (Phase 2): REST + WebSocket over a durable store with
// coordinator auth/RBAC. Every record reaching this cloud Big Peer is BRIDGED,
// proven by a signed bridge receipt; the trust fold is the vector-locked core
// (from venrescate-core-ts), never re-derived.
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import {
  fold as coreFold,
  verify as coreVerify,
  keyFromSeed,
  fingerprint,
  canon,
  computeReach,
  base64urlEncode,
  base64urlDecode,
} from '../../venrescate-core-ts/dist/index.js';
import { RecordStore } from './store.mjs';
import { Auth, hasRole } from './auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, '..', '..', '..', 'test-vectors');
const PORT = parseInt(process.env.PORT || '3002');
const DATA = process.env.VENRESCATE_DATA || join(__dirname, '..', 'data', 'records.jsonl');
// Pinned bridge identity (Big Peer). In production this seed lives in a KMS.
const BRIDGE_SEED = process.env.VENRESCATE_BRIDGE_SEED || 'b0'.repeat(32);
const ADMINS = (process.env.VENRESCATE_ADMINS || '').split(',').filter(Boolean);

const bridge = keyFromSeed(BRIDGE_SEED);
const store = new RecordStore(DATA);
const auth = new Auth({ secret: process.env.VENRESCATE_AUTH_SECRET, admins: ADMINS });

const pubRawById = {};
function registerPub(deviceId, pubRaw) {
  pubRawById[deviceId] = pubRaw;
}
registerPub(bridge.deviceId, bridge.publicKeyRaw);

// Seed known field identities so seeded vector records verify.
function load(name) {
  return JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));
}
for (const [, k] of Object.entries(load('keys.json'))) {
  const id = keyFromSeed(k.seed_hex);
  registerPub(id.deviceId, id.publicKeyRaw);
}

// Bridge receipts: sign that a record crossed into the cloud.
let serverSeq = 0;
function issueBridgeReceipt(rec) {
  if (store.bridgeReceiptFor(rec.id)) return;
  const t = Date.now();
  const body = {
    kind: 'bridge',
    target_id: rec.id,
    target_content_hash: rec.content_hash,
    server_hlc: `${t}.${serverSeq++}.${bridge.deviceId}`,
    bridge_id: bridge.deviceId,
    ts: t,
  };
  const sig = base64urlEncode(crypto.sign(null, Buffer.from(canon(body), 'utf8'), bridge.privateKey));
  store.setBridgeReceipt(rec.id, { ...body, sig, timestamp: t });
}

function seedFromVectors() {
  if (store.size > 0) return; // already persisted
  const crypt = load('crypto-vectors.json');
  const folds = load('fold-vectors.json');
  const ingest = (r) => {
    if (store.append(r)) issueBridgeReceipt(r);
  };
  ingest(crypt.cases[0].record);
  for (const sc of folds.scenarios) {
    ingest(sc.report);
    for (const att of sc.attestations) ingest(att);
  }
}
seedFromVectors();

// Server-assigned metadata is NOT part of the signed bytes — strip it before the fold
// re-verifies signatures (otherwise origin/_reach break verification).
function stripMeta(rec) {
  const { origin, _received_at, _reach, ...clean } = rec;
  void origin; void _received_at; void _reach;
  return clean;
}

// Trust fold delegates to the vector-locked core.
function foldFor(rec) {
  const subjectId = rec.subject_id || null;
  return coreFold(stripMeta(rec), store.attestationsFor(rec.id).map(stripMeta), pubRawById, subjectId);
}

function reachFor(rec) {
  const receipt = store.bridgeReceiptFor(rec.id);
  return computeReach(!!receipt, false, receipt ? { sig: receipt.sig, timestamp: receipt.timestamp } : undefined);
}

function clean(rec) {
  const { ...c } = rec;
  return c;
}

function recordMeta(rec) {
  const f = foldFor(rec);
  return {
    record: clean(rec),
    meta: {
      reach: reachFor(rec),
      tier: f.tier,
      tierName: f.tierName,
      verified: f.verified,
      disputed: f.disputed,
      locationVerified: f.locationVerified,
      origin: rec.origin || null,
    },
  };
}

// Coordinators see only records that reached the cloud (bridged/anchored) — never
// mesh-only records. Here, every persisted record has a bridge receipt by design.
function isVisible(rec) {
  return reachFor(rec).level !== 'in_mesh';
}

const wsClients = new Set();
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  for (const ws of wsClients) {
    try { ws.send(msg); } catch {}
  }
}

function sendJSON(res, code, obj) {
  res.writeHead(code).end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === 'POST' && path === '/v1/auth/challenge') {
      const { device_id } = await readBody(req);
      if (!device_id) return sendJSON(res, 400, { error: 'device_id required' });
      return sendJSON(res, 200, { nonce: auth.challenge(device_id) });
    }
    if (req.method === 'POST' && path === '/v1/auth/verify') {
      try {
        const { device_id, pub_b64u, sig } = await readBody(req);
        const result = auth.verify({ device_id, pub_b64u, sig });
        registerPub(result.device_id, result.pubRaw); // trust this key for fold/writes
        broadcast('coordinator:authenticated', { device_id: result.device_id, role: result.role });
        return sendJSON(res, 200, { token: result.token, role: result.role, device_id: result.device_id });
      } catch (e) {
        return sendJSON(res, 401, { error: e.message });
      }
    }

    // Pinned bridge key, so clients can verify reach receipts.
    if (req.method === 'GET' && path === '/v1/bridge-key') {
      return sendJSON(res, 200, { device_id: bridge.deviceId, pub_b64u: bridge.publicKeyB64u });
    }

    if (req.method === 'GET' && path === '/v1/records') {
      const kind = url.searchParams.get('kind');
      const prioMin = parseInt(url.searchParams.get('prio_min') || '0');
      const prioMax = parseInt(url.searchParams.get('prio_max') || '5');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const results = store
        .all()
        .filter(isVisible)
        .filter((r) => (!kind || r.kind === kind) && (r.prio == null || (r.prio >= prioMin && r.prio <= prioMax)))
        .slice(0, limit)
        .map(recordMeta);
      return sendJSON(res, 200, results);
    }

    const attMatch = path.match(/^\/v1\/records\/(.+)\/attestations$/);
    if (req.method === 'GET' && attMatch) {
      const atts = store.attestationsFor(decodeURIComponent(attMatch[1]));
      return sendJSON(res, 200, atts.map((a) => ({ record: clean(a), meta: { reach: reachFor(a), origin: a.origin || null } })));
    }

    const recMatch = path.match(/^\/v1\/records\/(.+)$/);
    if (req.method === 'GET' && recMatch) {
      const rec = store.get(decodeURIComponent(recMatch[1]));
      if (!rec || !isVisible(rec)) return sendJSON(res, 404, { error: 'not found or not bridged' });
      const f = foldFor(rec);
      const atts = store.attestationsFor(rec.id).map((a) => ({ record: clean(a), meta: { reach: reachFor(a), origin: a.origin || null } }));
      return sendJSON(res, 200, {
        record: clean(rec),
        meta: { reach: reachFor(rec), tier: f.tier, tierName: f.tierName, verified: f.verified, disputed: f.disputed, locationVerified: f.locationVerified, origin: rec.origin || null },
        attestations: atts,
        fold: f,
        bridge_receipt: store.bridgeReceiptFor(rec.id),
      });
    }

    if (req.method === 'POST' && path === '/v1/records') {
      const claims = auth.fromRequest(req);
      if (!hasRole(claims, 'coordinator', 'admin')) return sendJSON(res, 401, { error: 'authentication required' });
      const input = await readBody(req);
      const signerId = input.author_id || input.claimer_id;
      if (signerId !== claims.sub) return sendJSON(res, 403, { error: 'can only author as your own identity' });
      if (!input.sig) return sendJSON(res, 400, { error: 'record must be signed' });

      const signerKey = pubRawById[signerId];
      // origin is server-assigned metadata and is NOT part of the signed bytes.
      const toVerify = { ...input };
      delete toVerify.origin;
      if (!signerKey || !coreVerify(toVerify, signerKey)) return sendJSON(res, 403, { error: 'invalid signature' });

      const record = { ...toVerify, origin: 'online' };
      const isNew = store.append(record);
      if (isNew) issueBridgeReceipt(record);
      const meta = recordMeta(record);
      broadcast('record:created', meta);
      if (isNew) broadcast('record:bridged', { id: record.id, reach: reachFor(record) });
      return sendJSON(res, 201, meta);
    }

    if (req.method === 'GET' && path === '/v1/incidents') {
      const cells = new Map();
      for (const rec of store.all()) {
        if (rec.kind !== 'report' || !isVisible(rec)) continue;
        const pc = rec.payload?.plus_code || rec.payload?.plus_code8 || 'unknown';
        const cell = pc.substring(0, 8);
        const key = `${cell}:${rec.type}`;
        const inc = cells.get(key) || { id: key, cell, type: rec.type, count: 0, maxTier: 0, maxReach: 'in_mesh', disputed: false };
        const m = recordMeta(rec).meta;
        inc.count++;
        inc.maxTier = Math.max(inc.maxTier, m.tier);
        if (m.reach.level === 'bridged' || m.reach.level === 'anchored') inc.maxReach = m.reach.level;
        if (m.disputed) inc.disputed = true;
        cells.set(key, inc);
      }
      return sendJSON(res, 200, [...cells.values()]);
    }

    if (req.method === 'GET' && path === '/v1/exports') {
      const claims = auth.fromRequest(req);
      if (!hasRole(claims, 'admin')) return sendJSON(res, 403, { error: 'admin role required' });
      const rows = store.all().filter(isVisible).map((rec) => {
        const m = recordMeta(rec).meta;
        return { id: rec.id, kind: rec.kind, type: rec.type, prio: rec.prio, author: rec.author_id || rec.claimer_id, tier: m.tierName, reach: m.reach.level, disputed: m.disputed, content_hash: rec.content_hash, sig: rec.sig };
      });
      res.setHeader('Content-Type', 'text/csv');
      const header = 'id,kind,type,prio,author,tier,reach,disputed,content_hash,sig';
      const body = rows.map((r) => Object.values(r).map((v) => `${v ?? ''}`).join(',')).join('\n');
      return res.writeHead(200).end(header + '\n' + body);
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/v1/ws') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = {
    send: (data) => {
      const payload = Buffer.from(data, 'utf8');
      let frame;
      if (payload.length < 126) {
        frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81; frame[1] = payload.length; payload.copy(frame, 2);
      } else {
        frame = Buffer.alloc(4 + payload.length);
        frame[0] = 0x81; frame[1] = 126; frame.writeUInt16BE(payload.length, 2); payload.copy(frame, 4);
      }
      socket.write(frame);
    },
  };
  wsClients.add(ws);
  ws.send(JSON.stringify({ event: 'connected', data: { total_records: store.size, bridge_id: bridge.deviceId }, ts: Date.now() }));
  socket.on('data', (buf) => { if (buf[0] === 0x89) { const p = Buffer.alloc(2); p[0] = 0x8a; p[1] = 0; try { socket.write(p); } catch {} } });
  socket.on('close', () => wsClients.delete(ws));
  socket.on('error', () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`\n🟢 VenRescate API server (real) at http://localhost:${PORT}`);
  console.log(`   data:       ${DATA}`);
  console.log(`   bridge key: ${bridge.deviceId} (pinned)`);
  console.log(`   admins:     ${ADMINS.length ? ADMINS.join(', ') : '(none — all coordinators)'}`);
  console.log(`   records:    ${store.size} persisted\n`);
});

export { server };
