// venrescate-core-ts: crypto (Ed25519 sign/verify, device_id, content_hash)
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'crypto';
import { canon } from './canonical.js';
const PKCS8_ED25519_PREFIX = hexToBytes('302e020100300506032b657004220420');
const SPKI_ED25519_PREFIX = hexToBytes('302a300506032b6570032100');
export function keyFromSeed(seedHex) {
    const seed = hexToBytes(seedHex);
    if (seed.length !== 32)
        throw new Error('seed must be 32 bytes');
    const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
    const priv = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' });
    const rawPub = new Uint8Array(pubDer.subarray(-32));
    const pubB64u = base64urlEncode(rawPub);
    const deviceId = fingerprint(rawPub);
    return { seedHex, publicKeyRaw: rawPub, publicKeyB64u: pubB64u, deviceId, privateKey: priv };
}
export function fingerprint(pubRaw) {
    const hash = createHash('sha256').update(pubRaw).digest();
    return base64urlEncode(new Uint8Array(hash.subarray(0, 12)));
}
export function publicKeyFromRaw(rawPub) {
    const der = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(rawPub)]);
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
}
export function sign(recordNoSig, signer) {
    const canonical = canon(recordNoSig);
    const msg = Buffer.from(canonical, 'utf8');
    const sig = nodeSign(null, msg, signer.privateKey);
    const contentHash = createHash('sha256').update(msg).digest('hex');
    return { canonical, contentHash, sig: base64urlEncode(new Uint8Array(sig)) };
}
export function verify(record, pubRaw) {
    const pubKey = publicKeyFromRaw(pubRaw);
    const { sig, content_hash, ...noSig } = record;
    const msg = Buffer.from(canon(noSig), 'utf8');
    const sigBytes = Buffer.from(base64urlDecode(record.sig));
    return nodeVerify(null, msg, pubKey, sigBytes);
}
export function signPayload(payload, signer) {
    const msg = Buffer.from(canon(payload), 'utf8');
    const sig = nodeSign(null, msg, signer.privateKey);
    return base64urlEncode(new Uint8Array(sig));
}
export function verifyPayload(payload, sigB64u, pubRaw) {
    const pubKey = publicKeyFromRaw(pubRaw);
    const msg = Buffer.from(canon(payload), 'utf8');
    const sigBytes = Buffer.from(base64urlDecode(sigB64u));
    return nodeVerify(null, msg, pubKey, sigBytes);
}
export function base64urlEncode(bytes) {
    return Buffer.from(bytes).toString('base64url');
}
export function base64urlDecode(s) {
    return new Uint8Array(Buffer.from(s, 'base64url'));
}
function hexToBytes(s) {
    const bytes = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) {
        bytes[i / 2] = parseInt(s.substring(i, i + 2), 16);
    }
    return bytes;
}
export function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
export const IDS = {
    alice: '1111111111111111111111111111111111111111111111111111111111111111',
    bob: '2222222222222222222222222222222222222222222222222222222222222222',
    carol: '3333333333333333333333333333333333333333333333333333333333333333',
    dora: '4444444444444444444444444444444444444444444444444444444444444444',
    mallory: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
};
