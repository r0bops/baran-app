/**
 * HLC string: "<wall_ms>.<counter>.<node>"
 * wall_ms is DISPLAY-ONLY and MUST NOT gate replication, ordering, or expiry.
 * Sort key = (author_id, author_seq, hlc_counter).
 */
export interface HLCParsed {
    wallMs: number;
    counter: number;
    node: string;
}
export declare function parseHLC(hlc: string): HLCParsed;
export declare function makeHLC(wallMs: number, counter: number, nodeId: string): string;
/**
 * Sort key: (author_id, author_seq, hlc_counter)
 * Returns a comparable string for deterministic ordering.
 */
export declare function sortKey(authorId: string, authorSeq: number, hlc: string): string;
/**
 * Class-gated ingress accept/reject gate (P0-3).
 * P0/P1 are always accepted regardless of clock skew.
 * P2/P3 are quarantined when |author_wall - local_wall| > 30 min.
 * P4 is always accepted for display but may be deprioritized.
 *
 * Returns: { accepted: boolean, quarantined: boolean, reason: string }
 */
export interface IngressDecision {
    accepted: boolean;
    quarantined: boolean;
    reason: string;
}
export declare function ingressGate(priorityClass: number, authorWallMs: number, localWallMs: number, localBootCount: number, authorBootCount?: number): IngressDecision;
/**
 * TTL computation using monotonic clock deltas + boot count, never author wall_ms.
 * Returns remaining TTL in milliseconds, or -1 if expired.
 */
export declare function computeTTL(recordCreatedMonotonicMs: number, recordBootCount: number, currentMonotonicMs: number, currentBootCount: number, baseTtlMs: number, priorityClass: number): number;
