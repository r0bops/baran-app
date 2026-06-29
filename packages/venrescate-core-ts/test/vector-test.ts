// venrescate-core-ts: cross-language vector test
// Loads test-vectors/*.json and asserts exact agreement with gen-vectors.js outputs.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { canon, keyFromSeed, sign, verify, fold, IDS } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, '..', '..', '..', 'test-vectors');

function load(name: string) {
  return JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));
}

const keys = load('keys.json');
const cryptoVectors = load('crypto-vectors.json');
const foldVectors = load('fold-vectors.json');
const clockVectors = load('clock-vectors.json');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; return true; }
  console.error(`FAIL: ${msg}`);
  failed++;
  return false;
}

// 1. Derive identities from keys.json seeds
console.log('\n=== Identity derivation ===');
const identities: Record<string, ReturnType<typeof keyFromSeed>> = {};
for (const [name, k] of Object.entries(keys) as [string, any][]) {
  const id = keyFromSeed(k.seed_hex);
  identities[name] = id;
  assert(id.publicKeyB64u === k.public_key_b64u, `${name}: public key matches`);
  assert(id.deviceId === k.device_id, `${name}: device_id matches`);
}

const pubRawById: Record<string, Uint8Array> = {};
for (const [, id] of Object.entries(identities)) {
  pubRawById[id.deviceId] = id.publicKeyRaw;
}

// 2. Crypto vectors: sign & verify
console.log('\n=== Crypto vectors ===');
assert(cryptoVectors.cases[0].expect_verify === true, 'valid_signed_sos: expect true');
const sosAlice = cryptoVectors.cases[0].record;

// Re-sign: remove sig + content_hash, canonicalize, sign with alice
const { sig, content_hash, ...recordBody } = sosAlice;
const reSigned = sign(recordBody, identities.alice);
assert(reSigned.contentHash === (sosAlice as any).content_hash, 'valid_signed_sos: content_hash matches');
assert(reSigned.sig === (sosAlice as any).sig, 'valid_signed_sos: sig matches');

// Canonical bytes match
assert(canon(recordBody) === cryptoVectors.cases[0].canonical_bytes_utf8, 'valid_signed_sos: canonical bytes match');

// Verify
const verifyResult = verify(sosAlice, identities.alice.publicKeyRaw);
assert(verifyResult === true, 'valid_signed_sos: verify returns true');

// Tampered
const tampered = cryptoVectors.cases[1].record;
const tamperedVerify = verify(tampered, identities.alice.publicKeyRaw);
assert(tamperedVerify === false, 'tampered_payload: verify returns false');

// Wrong key
const wrongKeyVerify = verify(sosAlice, identities.bob.publicKeyRaw);
assert(wrongKeyVerify === false, 'wrong_key: verify returns false');

// 3. Fold vectors
console.log('\n=== Fold vectors ===');
for (const scenario of foldVectors.scenarios) {
  const name = scenario.name;
  const result = fold(scenario.report, scenario.attestations, pubRawById, scenario.subject_device_id || null);

  const expected = scenario.expected;
  assert(result.tier === expected.tier, `${name}: tier ${result.tier} === ${expected.tier}`);
  assert(result.tierName === expected.tierName, `${name}: tierName ${result.tierName} === ${expected.tierName}`);
  assert(result.verified === expected.verified, `${name}: verified ${result.verified} === ${expected.verified}`);
  assert(result.disputed === expected.disputed, `${name}: disputed ${result.disputed} === ${expected.disputed}`);
  assert(result.locationVerified === expected.location_verified, `${name}: location_verified ${result.locationVerified} === ${expected.location_verified}`);

  if (expected.note && result.note !== expected.note) {
    console.error(`  note mismatch: expected "${expected.note}", got "${result.note}"`);
  }
}

// 4. Clock vectors (logic check)
console.log('\n=== Clock vectors ===');
assert(clockVectors.cases[0].expected_order[0] === 'ELpoLIrRNROXHotW:1', 'causal_order: first record');
assert(clockVectors.cases[0].expected_order[1] === 'ELpoLIrRNROXHotW:2', 'causal_order: second record');
assert(clockVectors.cases[1].prio === 0, 'p0_future: prio is 0');
assert(clockVectors.cases[1].expected.includes('ACCEPTED'), 'p0_future: expected ACCEPTED');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
else console.log('ALL VECTORS PASS — TypeScript');
