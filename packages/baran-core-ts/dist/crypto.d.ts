import { createPrivateKey, createPublicKey } from 'crypto';
export interface BaranIdentity {
    seedHex: string;
    publicKeyRaw: Uint8Array;
    publicKeyB64u: string;
    deviceId: string;
    privateKey: ReturnType<typeof createPrivateKey>;
}
export declare function keyFromSeed(seedHex: string): BaranIdentity;
export declare function fingerprint(pubRaw: Uint8Array): string;
export declare function publicKeyFromRaw(rawPub: Uint8Array): ReturnType<typeof createPublicKey>;
export interface SignResult {
    canonical: string;
    contentHash: string;
    sig: string;
}
export declare function sign(recordNoSig: Record<string, unknown>, signer: BaranIdentity): SignResult;
export declare function verify(record: Record<string, unknown>, pubRaw: Uint8Array): boolean;
export declare function signPayload(payload: Record<string, unknown>, signer: BaranIdentity): string;
export declare function verifyPayload(payload: Record<string, unknown>, sigB64u: string, pubRaw: Uint8Array): boolean;
export declare function base64urlEncode(bytes: Uint8Array): string;
export declare function base64urlDecode(s: string): Uint8Array;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare const IDS: Record<string, string>;
