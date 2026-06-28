// Operational claim/status vocabulary for coordinator follow-ups (separate from the
// cryptographic trust tier — this is "who is handling it", not "is it true").
export const STATUS_META: Record<string, { label: string; color: string }> = {
  reconocido: { label: 'reconocido', color: '#94a3b8' },
  en_camino: { label: 'en camino', color: '#3b82f6' },
  en_sitio: { label: 'en sitio', color: '#f59e0b' },
  resuelto: { label: 'resuelto', color: '#22c55e' },
  sin_recursos: { label: 'sin recursos', color: '#ef4444' },
};

export interface StatusUpdate {
  status: string;
  claimedBy: string;
  note?: string;
  hlc: string;
  createdWallMs?: number;
}

/** Extract claim/status updates that reference a given report id, from the report set. */
export function statusUpdatesFor(targetId: string, records: Array<{ record: Record<string, unknown> }>): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const r of records) {
    const rec = r.record;
    if (rec.type !== 'status') continue;
    const p = rec.payload as Record<string, unknown> | undefined;
    const refs = p?.refs as string[] | undefined;
    if (!p?.status || !Array.isArray(refs) || !refs.includes(targetId)) continue;
    out.push({
      status: String(p.status),
      claimedBy: String(p.claimed_by ?? rec.author_id ?? ''),
      note: p.msg ? String(p.msg) : undefined,
      hlc: String(rec.hlc ?? ''),
      createdWallMs: rec.created_wall_ms as number | undefined,
    });
  }
  return out.sort((a, b) => a.hlc.localeCompare(b.hlc));
}
