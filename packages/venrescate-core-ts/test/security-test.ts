// Adversarial tests for the trust core: a forged, replayed, or tampered record
// must never gain trust it didn't earn. Run with: node --loader ts-node/esm test/security-test.ts
import { keyFromSeed, sign, verify, canon, IDS } from '../src/index.js';
import type { VenRescateIdentity } from '../src/crypto.js';
import { fold } from '../src/fold.js';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error('  FAIL:', msg); }
}

const alice = keyFromSeed(IDS.alice);
const bob = keyFromSeed(IDS.bob);
const carol = keyFromSeed(IDS.carol);
const mallory = keyFromSeed(IDS.mallory);
const ids: Record<string, Uint8Array> = {
  [alice.deviceId]: alice.publicKeyRaw,
  [bob.deviceId]: bob.publicKeyRaw,
  [carol.deviceId]: carol.publicKeyRaw,
  [mallory.deviceId]: mallory.publicKeyRaw,
};

function report(author: VenRescateIdentity, seq: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schema_version: 1, kind: 'report', id: `${author.deviceId}:${seq}`,
    author_id: author.deviceId, author_seq: seq, type: 'sos', prio: 0,
    created_wall_ms: 1_750_000_000_000, hlc: `1750000000000.0.${author.deviceId}`,
    payload: { note: 'atrapado', plus_code: '77GR2J4C+9P' }, ...over,
  };
  const s = sign(body, author);
  return { ...body, content_hash: s.contentHash, sig: s.sig };
}

function attest(claimer: VenRescateIdentity, seq: number, target: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schema_version: 1, kind: 'attestation', id: `${claimer.deviceId}:a:${seq}`,
    claimer_id: claimer.deviceId, claimer_seq: seq, target_report_id: target.id,
    target_content_hash: target.content_hash, att_type: 'corroborate', fact: 'still_needs_help',
    prio: 0, hlc: `1750000000000.0.${claimer.deviceId}`, ...over,
  };
  const s = sign(body, claimer);
  return { ...body, content_hash: s.contentHash, sig: s.sig };
}

console.log('VenRescate adversarial security suite (core)\n');

// 1. Body tamper invalidates the signature.
console.log('1. Tampering a signed body breaks verification');
{
  const r = report(alice, 1);
  check(verify(r, alice.publicKeyRaw), 'pristine report verifies');
  const tampered = { ...r, payload: { note: 'all clear', plus_code: '77GR2J4C+9P' } };
  check(!verify(tampered, alice.publicKeyRaw), 'tampered payload fails verification');
  const reprio = { ...r, prio: 4 };
  check(!verify(reprio, alice.publicKeyRaw), 'flipping prio fails verification');
  check(fold(tampered, [], ids, null).tierName === 'invalid', 'tampered report folds to invalid');
}

// 2. Wrong-key / forged signatures are rejected.
console.log('2. Forged and wrong-key signatures rejected');
{
  const r = report(alice, 1);
  check(!verify(r, bob.publicKeyRaw), "alice's record does not verify under bob's key");
  const garbage = { ...r, sig: 'A'.repeat(86) };
  check(!verify(garbage, alice.publicKeyRaw), 'garbage signature rejected');
  const truncated = { ...r, sig: String(r.sig).slice(0, 40) };
  check(!verify(truncated, alice.publicKeyRaw), 'truncated signature rejected');
}

// 3. Impersonation: claim someone else's id but sign with your own key.
console.log('3. Attestation claiming a foreign id is dropped by the fold');
{
  const r = report(alice, 1);
  // mallory signs, but stamps claimer_id = carol (impersonation attempt)
  const body: Record<string, unknown> = {
    schema_version: 1, kind: 'attestation', id: `${carol.deviceId}:a:1`,
    claimer_id: carol.deviceId, claimer_seq: 1, target_report_id: r.id,
    target_content_hash: r.content_hash, att_type: 'corroborate', fact: 'still_needs_help',
    prio: 0, hlc: `1750000000000.0.${carol.deviceId}`,
  };
  const s = sign(body, mallory); // signed by the WRONG key
  const forged = { ...body, content_hash: s.contentHash, sig: s.sig };
  const bobAtt = attest(bob, 1, r);
  const res = fold(r, [forged, bobAtt], ids, null);
  check(res.tierName === 'reported', 'impersonated attestation ignored — only bob counts, stays reported');
}

// 4. Sybil: one key cannot manufacture corroboration.
console.log('4. Sybil — one key attesting many times is still one corroborator');
{
  const r = report(alice, 1);
  const many = [2, 3, 4, 5].map((seq) => attest(bob, seq, r));
  check(fold(r, many, ids, null).tierName === 'reported', '4 attestations from bob = 1 distinct key → reported');
  const withCarol = [...many, attest(carol, 1, r)];
  check(fold(r, withCarol, ids, null).tierName === 'corroborated', 'bob + carol = 2 distinct → corroborated');
}

// 5. Invalid proximity proof must not promote tier.
console.log('5. A non-matching on_site proof does not reach on_site');
{
  const r = report(alice, 1);
  const bad = attest(bob, 1, r, { att_type: 'on_site', proof: { type: 'pluscode', match: false, plus_code8: 'ZZZZZZZZ' } });
  check(fold(r, [bad], ids, null).tier < 3, 'proof.match=false → below on_site');
  const good = attest(carol, 1, r, { att_type: 'on_site', proof: { type: 'pluscode', match: true, plus_code8: '77GR2J4C' } });
  check(fold(r, [good], ids, null).tierName === 'on_site', 'proof.match=true → on_site');
}

// 6. Skewed author clock cannot suppress a record (wall_ms is display-only).
console.log('6. A far-future author clock does not change trust or validity');
{
  const future = report(alice, 1, { created_wall_ms: 9_999_999_999_999, hlc: `9999999999999.0.${alice.deviceId}` });
  check(verify(future, alice.publicKeyRaw), 'future-dated P0 still verifies');
  check(fold(future, [], ids, null).tierName === 'reported', 'future-dated P0 still folds normally (not suppressed)');
}

// 7. content_hash is deterministic — a replay is byte-identical and dedupes.
console.log('7. Replays are byte-identical (content_hash dedup)');
{
  const a = report(alice, 1);
  const b = report(alice, 1);
  check(a.content_hash === b.content_hash, 'same body → same content_hash (replay detectable)');
  check(canon(a) === canon(b), 'canonical bytes identical');
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? 'ALL SECURITY TESTS PASS — core' : 'SECURITY TESTS FAILED');
process.exit(failed === 0 ? 0 : 1);
