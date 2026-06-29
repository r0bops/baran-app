// venrescate-core-ts: Reach ladder computation
// Contract §5, §7 — reach is computed, never asserted
// in_mesh → bridged → anchored, shown separately from trust tier
/**
 * Compute reach from the presence of signed bridge receipts and GenLayer anchors.
 * A record starts 'in_mesh' and moves up only when concrete receipts exist.
 */
export function computeReach(hasBridgeReceipt, hasAnchorTx, bridgeReceipt, anchorTx) {
    if (hasAnchorTx && anchorTx) {
        return { level: 'anchored', bridgeReceiptSig: bridgeReceipt?.sig, bridgeTimestamp: bridgeReceipt?.timestamp, anchorTxHash: anchorTx.txHash };
    }
    if (hasBridgeReceipt && bridgeReceipt) {
        return { level: 'bridged', bridgeReceiptSig: bridgeReceipt.sig, bridgeTimestamp: bridgeReceipt.timestamp };
    }
    return { level: 'in_mesh' };
}
/**
 * Reach labels in Spanish (es-VE)
 */
export const REACH_LABELS = {
    in_mesh: 'en la red',
    bridged: 'llegó a internet',
    anchored: 'anclado',
};
/**
 * Reach descriptions for UI
 */
export const REACH_DESCRIPTIONS = {
    in_mesh: 'Solo visible en la red local. No ha sido enviado a internet aún.',
    bridged: 'Llegó a internet. Visible para coordinadores remotos.',
    anchored: 'Anclado en registro inmutable. Verificación criptográfica permanente.',
};
/**
 * Tier labels in Spanish (es-VE)
 */
export const TIER_LABELS = {
    invalid: 'inválido',
    reported: 'reportado',
    corroborated: 'corroborado',
    on_site: 'en sitio',
    device_confirmed: 'confirmado por dispositivo',
    self_confirmed: 'autoconfirmado',
};
/**
 * Tier descriptions for UI
 */
export const TIER_DESCRIPTIONS = {
    reported: 'Un solo reporte firmado. Aún sin verificar.',
    corroborated: 'Dos o más personas independientes confirman la misma situación.',
    on_site: 'Alguien estuvo en el lugar y aportó prueba de proximidad.',
    device_confirmed: 'El dispositivo de la persona afectada confirmó su presencia.',
    self_confirmed: 'La persona afectada confirmó directamente.',
    disputed: 'Hay testimonios contradictorios. Ambos lados se muestran.',
};
/**
 * Priority class labels in Spanish
 */
export const PRIORITY_LABELS = {
    0: 'P0 — Crítico (vida en riesgo)',
    1: 'P1 — Urgente',
    2: 'P2 — Importante',
    3: 'P3 — Rutina',
    4: 'P4 — Informativo',
    5: 'P5 — Baja prioridad',
};
