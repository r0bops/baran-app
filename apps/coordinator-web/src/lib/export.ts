// Provenance-preserving exports. Every row/feature carries the signing identity,
// signature, content hash, HLC, computed trust tier and reach — so an exported
// dataset remains independently verifiable, never a bare dashboard dump.
import type { VenRescateRecord } from './api';
import { decodePlusCode } from './plus-code';

function plusCodeOf(r: Record<string, unknown>): string | undefined {
  const p = r.payload as Record<string, unknown> | undefined;
  return (p?.plus_code as string) || (p?.plus_code8 as string) || undefined;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const COLUMNS: { key: string; get: (b: VenRescateRecord) => unknown }[] = [
  { key: 'id', get: (b) => b.record.id },
  { key: 'kind', get: (b) => b.record.kind },
  { key: 'type', get: (b) => b.record.type },
  { key: 'prio', get: (b) => b.record.prio },
  { key: 'author_id', get: (b) => b.record.author_id ?? b.record.claimer_id },
  { key: 'tier', get: (b) => b.meta.tier },
  { key: 'tier_name', get: (b) => b.meta.tierName },
  { key: 'verified', get: (b) => b.meta.verified },
  { key: 'disputed', get: (b) => b.meta.disputed },
  { key: 'location_verified', get: (b) => b.meta.locationVerified },
  { key: 'reach', get: (b) => b.meta.reach?.level },
  { key: 'plus_code', get: (b) => plusCodeOf(b.record) },
  { key: 'hlc', get: (b) => b.record.hlc },
  { key: 'created_wall_ms', get: (b) => b.record.created_wall_ms },
  { key: 'content_hash', get: (b) => b.record.content_hash },
  { key: 'sig', get: (b) => b.record.sig },
];

export function toCSV(records: VenRescateRecord[]): string {
  const header = COLUMNS.map((c) => c.key).join(',');
  const rows = records.map((b) => COLUMNS.map((c) => csvCell(c.get(b))).join(','));
  return [header, ...rows].join('\n');
}

export function toGeoJSON(records: VenRescateRecord[]): string {
  const features = records.map((b) => {
    const pos = decodePlusCode(plusCodeOf(b.record));
    return {
      type: 'Feature',
      geometry: pos ? { type: 'Point', coordinates: [pos.lng, pos.lat] } : null,
      properties: {
        id: b.record.id,
        kind: b.record.kind,
        type: b.record.type,
        prio: b.record.prio,
        author_id: b.record.author_id ?? b.record.claimer_id,
        tier: b.meta.tier,
        tier_name: b.meta.tierName,
        verified: b.meta.verified,
        disputed: b.meta.disputed,
        location_verified: b.meta.locationVerified,
        reach: b.meta.reach?.level,
        plus_code: plusCodeOf(b.record),
        hlc: b.record.hlc,
        content_hash: b.record.content_hash,
        sig: b.record.sig,
      },
    };
  });
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
