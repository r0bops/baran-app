export type ReachLevel = 'in_mesh' | 'bridged' | 'anchored';
export interface ReachState {
    level: ReachLevel;
    bridgeReceiptSig?: string;
    bridgeTimestamp?: number;
    anchorTxHash?: string;
}
/**
 * Compute reach from the presence of signed bridge receipts and GenLayer anchors.
 * A record starts 'in_mesh' and moves up only when concrete receipts exist.
 */
export declare function computeReach(hasBridgeReceipt: boolean, hasAnchorTx: boolean, bridgeReceipt?: {
    sig: string;
    timestamp: number;
}, anchorTx?: {
    txHash: string;
}): ReachState;
/**
 * Reach labels in Spanish (es-VE)
 */
export declare const REACH_LABELS: Record<ReachLevel, string>;
/**
 * Reach descriptions for UI
 */
export declare const REACH_DESCRIPTIONS: Record<ReachLevel, string>;
/**
 * Tier labels in Spanish (es-VE)
 */
export declare const TIER_LABELS: Record<string, string>;
/**
 * Tier descriptions for UI
 */
export declare const TIER_DESCRIPTIONS: Record<string, string>;
/**
 * Priority class labels in Spanish
 */
export declare const PRIORITY_LABELS: Record<number, string>;
