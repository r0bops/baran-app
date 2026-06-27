// Coordinator auth + RBAC via Ed25519 challenge-response: the key that signs
// records is the key that authenticates. Issues short-lived HMAC bearer tokens
// carrying device_id + role; the role gates privileged routes.
import crypto from 'crypto';
import { canon, verifyPayload, fingerprint, base64urlDecode } from '../../baran-core-ts/dist/index.js';

const NONCE_TTL_MS = 2 * 60 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export class Auth {
  constructor({ secret, admins = [] } = {}) {
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.admins = new Set(admins);
    this.nonces = new Map();
  }

  challenge(deviceId) {
    const nonce = crypto.randomBytes(24).toString('base64url');
    this.nonces.set(deviceId, { nonce, exp: Date.now() + NONCE_TTL_MS });
    return nonce;
  }

  /** Verify a signed challenge. Returns { token, role, device_id } or throws. */
  verify({ device_id, pub_b64u, sig }) {
    const pubRaw = base64urlDecode(pub_b64u);
    if (pubRaw.length !== 32) throw new Error('pubkey must be 32 bytes');
    // Anti-spoof: the device_id MUST be derived from the presented key.
    if (fingerprint(pubRaw) !== device_id) throw new Error('device_id does not match key');

    const entry = this.nonces.get(device_id);
    if (!entry || entry.exp < Date.now()) throw new Error('no active challenge');
    const ok = verifyPayload({ device_id, nonce: entry.nonce }, sig, pubRaw);
    if (!ok) throw new Error('challenge signature invalid');
    this.nonces.delete(device_id);

    const role = this.admins.has(device_id) ? 'admin' : 'coordinator';
    return { token: this._issue(device_id, role), role, device_id, pubRaw };
  }

  _issue(sub, role) {
    const payload = base64url(JSON.stringify({ sub, role, exp: Date.now() + TOKEN_TTL_MS }));
    const mac = this._mac(payload);
    return `${payload}.${mac}`;
  }

  _mac(payload) {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** Returns the token claims if valid, else null. */
  parse(token) {
    if (!token) return null;
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = this._mac(payload);
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return null;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.exp < Date.now()) return null;
      return claims;
    } catch {
      return null;
    }
  }

  /** Extract + validate the bearer token from a request. Returns claims or null. */
  fromRequest(req) {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? this.parse(m[1]) : null;
  }
}

function base64url(s) {
  return Buffer.from(s, 'utf8').toString('base64url');
}

export const ROLES = { ADMIN: 'admin', COORDINATOR: 'coordinator' };
export function hasRole(claims, ...allowed) {
  return !!claims && allowed.includes(claims.role);
}
