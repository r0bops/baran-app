// baran-core-ts: HLC (Hybrid Logical Clock) module
// Contract §6 — causal sort key, class-gated ingress, monotonic-TTL
export function parseHLC(hlc) {
    const parts = hlc.split('.');
    if (parts.length !== 3)
        throw new Error(`Invalid HLC: ${hlc}`);
    return {
        wallMs: parseInt(parts[0], 10),
        counter: parseInt(parts[1], 10),
        node: parts[2],
    };
}
export function makeHLC(wallMs, counter, nodeId) {
    return `${wallMs}.${counter}.${nodeId}`;
}
/**
 * Sort key: (author_id, author_seq, hlc_counter)
 * Returns a comparable string for deterministic ordering.
 */
export function sortKey(authorId, authorSeq, hlc) {
    const p = parseHLC(hlc);
    return `${authorId}:${String(authorSeq).padStart(10, '0')}:${String(p.counter).padStart(10, '0')}`;
}
export function ingressGate(priorityClass, authorWallMs, localWallMs, localBootCount, authorBootCount) {
    const DRIFT_30_MIN_MS = 30 * 60 * 1000;
    // P0/P1: always accepted, never quarantined
    if (priorityClass <= 1) {
        return { accepted: true, quarantined: false, reason: 'P0/P1 always accepted regardless of clock skew' };
    }
    // Boot count mismatch — treat with caution
    if (authorBootCount !== undefined && authorBootCount !== localBootCount) {
        // Accept but quarantine: the clocks may have reset
        return { accepted: true, quarantined: true, reason: `boot_count mismatch: author=${authorBootCount} local=${localBootCount}` };
    }
    const drift = Math.abs(authorWallMs - localWallMs);
    if (drift > DRIFT_30_MIN_MS) {
        return { accepted: true, quarantined: true, reason: `clock drift ${drift}ms exceeds 30 min threshold` };
    }
    return { accepted: true, quarantined: false, reason: 'within tolerance' };
}
/**
 * TTL computation using monotonic clock deltas + boot count, never author wall_ms.
 * Returns remaining TTL in milliseconds, or -1 if expired.
 */
export function computeTTL(recordCreatedMonotonicMs, recordBootCount, currentMonotonicMs, currentBootCount, baseTtlMs, priorityClass) {
    // P0: effectively permanent (30 days)
    if (priorityClass === 0)
        baseTtlMs = 30 * 24 * 60 * 60 * 1000;
    if (currentBootCount !== recordBootCount) {
        // Boot occurred — use conservative TTL (50% of base)
        const elapsed = currentMonotonicMs + (baseTtlMs / 2);
        return Math.max(-1, baseTtlMs - elapsed);
    }
    const elapsed = currentMonotonicMs - recordCreatedMonotonicMs;
    const remaining = baseTtlMs - elapsed;
    return remaining > 0 ? remaining : -1;
}
