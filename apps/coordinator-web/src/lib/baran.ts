// Browser-side Baran crypto + canonical serializer.
// Byte-identical to packages/baran-core-ts (verified against node:crypto):
//   - canonical JSON = sorted keys, integers only, JSON.stringify for strings
//   - device_id      = base64url(sha256(pubRaw)[0:12])
//   - content_hash   = sha256(canonical) hex
//   - sig            = base64url(Ed25519(canonical))
// The coordinator's Ed25519 private key never leaves the browser.
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';

// noble-ed25519 v2 needs a sync sha512 to expose sync sign/verify/getPublicKey.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

// ---- canonical JSON (mirrors canonical.ts / gen-vectors.js canon()) ----
export function canon(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canon((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('non-integer number in record: ' + value);
    return String(value);
  }
  return JSON.stringify(value);
}

// ---- base64url (browser, no Buffer) ----
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.substring(i, i + 2), 16);
  return out;
}

// ---- identity ----
export interface Identity {
  seed: Uint8Array;
  seedHex: string;
  publicKeyRaw: Uint8Array;
  publicKeyB64u: string;
  deviceId: string;
}

export function identityFromSeed(seed: Uint8Array): Identity {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const pub = ed.getPublicKey(seed);
  return {
    seed,
    seedHex: bytesToHex(seed),
    publicKeyRaw: pub,
    publicKeyB64u: base64urlEncode(pub),
    deviceId: fingerprint(pub),
  };
}

export function randomIdentity(): Identity {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return identityFromSeed(seed);
}

export function fingerprint(pubRaw: Uint8Array): string {
  return base64urlEncode(sha256(pubRaw).subarray(0, 12));
}

// ---- sign / verify ----
export interface SignResult {
  canonical: string;
  content_hash: string;
  sig: string;
}

/** Sign a record body (the object MUST NOT contain content_hash or sig). */
export function signRecord(recordNoSig: Record<string, unknown>, id: Identity): SignResult {
  const canonical = canon(recordNoSig);
  const msg = new TextEncoder().encode(canonical);
  const sig = ed.sign(msg, id.seed);
  return {
    canonical,
    content_hash: bytesToHex(sha256(msg)),
    sig: base64urlEncode(sig),
  };
}

export function verifyRecord(record: Record<string, unknown>, pubRaw: Uint8Array): boolean {
  const { sig, content_hash, _received_at, _reach, ...noSig } = record as Record<string, unknown>;
  void content_hash;
  void _received_at;
  void _reach;
  const msg = new TextEncoder().encode(canon(noSig));
  try {
    return ed.verify(base64urlDecode(sig as string), msg, pubRaw);
  } catch {
    return false;
  }
}
