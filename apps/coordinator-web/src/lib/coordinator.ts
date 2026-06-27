// Coordinator identity + action builders.
// The coordinator signs its OWN records locally with Ed25519 (key persisted in
// localStorage, never sent to the server). Records authored here are online-origin
// and therefore lower-trust until verified in-zone — the fold treats them like any
// other signer, so a coordinator can never fake a higher trust tier.
import {
  identityFromSeed,
  randomIdentity,
  signRecord,
  hexToBytes,
  type Identity,
} from './baran';
import { authChallenge, authVerify, setAuthToken } from './api';
import { loadSeedHex, saveSeedHex } from './secureStore';

const SEED_KEY = 'baran.coordinator.seed';
const SEQ_KEY = 'baran.coordinator.seq';

let cached: Identity | null = null;

/**
 * Initialise the coordinator identity from the OS keychain (desktop) or
 * localStorage (browser), generating + persisting a new key on first run.
 * Call once at startup BEFORE getCoordinator().
 */
export async function initCoordinator(): Promise<Identity> {
  let seedHex = await loadSeedHex();
  if (!seedHex || !/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    const fresh = randomIdentity();
    seedHex = fresh.seedHex;
    await saveSeedHex(seedHex);
  }
  localStorage.setItem(SEED_KEY, seedHex);
  cached = identityFromSeed(hexToBytes(seedHex.toLowerCase()));
  return cached;
}

export function getCoordinator(): Identity {
  if (cached) return cached;
  let seedHex = localStorage.getItem(SEED_KEY);
  if (seedHex && seedHex.length === 64) {
    cached = identityFromSeed(hexToBytes(seedHex));
  } else {
    cached = randomIdentity();
    localStorage.setItem(SEED_KEY, cached.seedHex);
  }
  return cached;
}

/** Load a coordinator key from a 64-char hex seed (e.g. a pre-registered key). */
export function importCoordinatorSeed(seedHex: string): Identity {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error('seed must be 64 hex chars');
  cached = identityFromSeed(hexToBytes(seedHex.toLowerCase()));
  localStorage.setItem(SEED_KEY, cached.seedHex);
  return cached;
}

/** Authenticate with the backend via Ed25519 challenge-response.
 *  Returns the granted role, or null when the backend has no auth (the stub). */
export async function ensureAuth(): Promise<string | null> {
  const id = getCoordinator();
  const nonce = await authChallenge(id.deviceId);
  if (nonce === null) {
    setAuthToken(null);
    return null; // stub: no auth required
  }
  // Sign canon({ device_id, nonce }) — the same Ed25519 key that signs records.
  const { sig } = signRecord({ device_id: id.deviceId, nonce }, id);
  const { token, role } = await authVerify({ device_id: id.deviceId, pub_b64u: id.publicKeyB64u, sig });
  setAuthToken(token);
  return role;
}

function nextSeq(): number {
  const n = parseInt(localStorage.getItem(SEQ_KEY) || '0', 10) + 1;
  localStorage.setItem(SEQ_KEY, String(n));
  return n;
}

function now(): number {
  return Date.now();
}

export type ResolveFact = 'found_safe' | 'false' | 'still_needs_help';

interface TargetInfo {
  id: string;
  content_hash: string;
  prio?: number;
  plus_code?: string;
}

/** A signed `status` report that references a target report (the coordinator's reply). */
export function buildStatusReply(target: TargetInfo, msg: string): Record<string, unknown> {
  const id = getCoordinator();
  const seq = nextSeq();
  const t = now();
  const body: Record<string, unknown> = {
    schema_version: 1,
    kind: 'report',
    id: `${id.deviceId}:${seq}`,
    author_id: id.deviceId,
    author_seq: seq,
    type: 'status',
    prio: target.prio ?? 2,
    created_wall_ms: t,
    hlc: `${t}.0.${id.deviceId}`,
    payload: { msg, refs: [target.id], ...(target.plus_code ? { plus_code: target.plus_code } : {}) },
  };
  const { content_hash, sig } = signRecord(body, id);
  return { ...body, content_hash, sig };
}

function buildAttestation(
  target: TargetInfo,
  att_type: string,
  fact: string
): Record<string, unknown> {
  const id = getCoordinator();
  const seq = nextSeq();
  const t = now();
  const body: Record<string, unknown> = {
    schema_version: 1,
    kind: 'attestation',
    id: `${id.deviceId}:a:${seq}`,
    claimer_id: id.deviceId,
    claimer_seq: seq,
    target_report_id: target.id,
    target_content_hash: target.content_hash,
    att_type,
    fact,
    prio: target.prio ?? 2,
    created_wall_ms: t,
    hlc: `${t}.0.${id.deviceId}`,
  };
  const { content_hash, sig } = signRecord(body, id);
  return { ...body, content_hash, sig };
}

/** Mark a report resolved (found_safe / false alarm). Recorded as an independent
 *  attestation — only the ORIGINAL reporter's resolve flips the `verified` flag. */
export function buildResolve(target: TargetInfo, fact: ResolveFact): Record<string, unknown> {
  return buildAttestation(target, 'resolve', fact);
}

/** Flag a contradiction. Surfaces the dispute overlay; never auto-resolves. */
export function buildDispute(target: TargetInfo): Record<string, unknown> {
  return buildAttestation(target, 'dispute', 'false');
}

/** Corroborate from the coordinator (online-origin, lower trust). */
export function buildCorroborate(target: TargetInfo): Record<string, unknown> {
  return buildAttestation(target, 'corroborate', 'still_needs_help');
}
