// venrescate-core-ts: Signed record store interfaces
// Contract §7, P0-1 — abstraction over Ditto/fallback sync transport

import type { ReachState } from '../reach/reach.js';

export interface SignedRecord {
  id: string;
  kind: 'report' | 'attestation';
  schemaVersion: number;
  authorId: string;
  canonicalBytes: Uint8Array;
  contentHash: string;
  sig: string;
  hlc: string;
  prio: number;
  record: Record<string, unknown>; // parsed JSON
}

export interface StoredRecord extends SignedRecord {
  receivedMonotonicMs: number;
  receivedBootCount: number;
  reach: ReachState;
  ttlRemainingMs: number;
  locallyVerified: boolean;
}

export interface SyncQuery {
  kind?: 'report' | 'attestation';
  prioMin?: number;
  prioMax?: number;
  geoCell?: string;
  sinceHlc?: string;
  limit?: number;
}

export interface SyncEvent {
  type: 'insert' | 'update' | 'remove';
  record: StoredRecord;
}

export interface PeerInfo {
  peerId: string;
  transports: string[];
  connected: boolean;
  rssi?: number;
}

export interface TransportConfig {
  enableBLE: boolean;
  enableWiFiDirect: boolean;
  enableLAN: boolean;
  dutyCycle: 'normal' | 'conserve' | 'frugal' | 'lifeline';
}

/**
 * Abstraction over the sync transport layer.
 * Android implements with Ditto Kotlin SDK (or NearbyTransport fallback).
 * Coordinator surfaces read from the cloud API, not this interface.
 */
export interface SyncTransport {
  start(config: TransportConfig): Promise<void>;
  stop(): Promise<void>;
  subscribe(query: SyncQuery): AsyncIterable<SyncEvent>;
  publish(record: SignedRecord): Promise<void>;
  peers(): AsyncIterable<PeerInfo>;
}

/**
 * Local signed-record store with verification.
 * Both mesh nodes and coordinator clients implement this.
 */
export interface SignedRecordStore {
  put(record: SignedRecord): Promise<void>;
  get(id: string): Promise<StoredRecord | null>;
  query(query: SyncQuery): Promise<StoredRecord[]>;
  verifyAll(): Promise<{ total: number; valid: number; invalid: string[] }>;
  evictExpired(): Promise<number>;
}
