// Generic engine that turns any SourceConfig into map points — fetch (cached for
// offline) → normalise → filter → map. No per-API code lives here; everything is
// driven by config/sources.ts.
import type { SourceConfig } from '../config/sources';
import type { OverlayPoint } from './overlays';
import { fetchCached, type Cached } from './cache';

export type NormalizedRecord = Record<string, unknown> & { _lat: number; _lng: number };

function magColor(m: number): string {
  if (m >= 6) return '#7f1d1d';
  if (m >= 5) return '#dc2626';
  if (m >= 4) return '#f97316';
  if (m >= 3) return '#eab308';
  return '#22d3ee';
}

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v ?? '');
}

function colorOf(r: NormalizedRecord, c: SourceConfig): string {
  const spec = c.color;
  if (!spec) return c.swatch;
  if ('magnitude' in spec) return magColor(Number(r[spec.magnitude]) || 0);
  return spec.map[String(r[spec.field])] || spec.fallback;
}

function radiusOf(r: NormalizedRecord, c: SourceConfig): number {
  const spec = c.radius;
  if (spec == null) return 5;
  if (typeof spec === 'number') return spec;
  return Math.max(spec.min, (Number(r[spec.magnitude]) || 0) * spec.scale);
}

function titleOf(r: NormalizedRecord, c: SourceConfig): string {
  if (c.titleTemplate) return c.titleTemplate.replace(/\$\{(\w+)\}/g, (_m, k) => fmtVal(r[k]));
  if (c.title) return String(r[c.title] ?? '');
  return '';
}

function subtitleOf(r: NormalizedRecord, c: SourceConfig): string {
  return (c.subtitle || []).map((f) => r[f]).filter(Boolean).join(' · ');
}

export function toPoints(records: NormalizedRecord[], c: SourceConfig): OverlayPoint[] {
  return records.map((r, i) => ({
    id: `${c.id}:${(r.id as string) ?? i}`,
    lat: r._lat,
    lng: r._lng,
    title: titleOf(r, c),
    subtitle: subtitleOf(r, c),
    color: colorOf(r, c),
    radius: radiusOf(r, c),
    sourceId: c.id,
    sourceLabel: c.label,
    source_url: c.linkField ? (r[c.linkField] as string) : undefined,
  }));
}

async function doFetch(c: SourceConfig, signal?: AbortSignal): Promise<NormalizedRecord[]> {
  const res = await fetch(c.url, { signal });
  if (!res.ok) throw new Error(`${c.id} ${res.status}`);
  const json = await res.json();

  let records: NormalizedRecord[];
  if (c.format === 'geojson') {
    const feats = (json.features || []) as Array<{ id: string; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }>;
    records = feats.map((f) => {
      const [lng, lat] = f.geometry?.coordinates || [];
      return { ...(f.properties || {}), id: f.id, _lat: Number(lat), _lng: Number(lng) };
    });
  } else {
    records = (json as Record<string, unknown>[]).map((r) => ({ ...r, _lat: Number(r[c.lat!]), _lng: Number(r[c.lng!]) }));
  }

  records = records.filter((r) => Number.isFinite(r._lat) && Number.isFinite(r._lng));
  if (c.bbox) {
    const b = c.bbox;
    records = records.filter((r) => r._lat >= b.minLat && r._lat <= b.maxLat && r._lng >= b.minLng && r._lng <= b.maxLng);
  }
  return records;
}

/** Load a source's records, cached locally for offline use. */
export function loadSource(c: SourceConfig, signal?: AbortSignal): Promise<Cached<NormalizedRecord[]>> {
  return fetchCached<NormalizedRecord[]>(`src:${c.id}`, () => doFetch(c, signal), []);
}

export function applySourceFilters(records: NormalizedRecord[], c: SourceConfig, state: Record<string, string[]>): NormalizedRecord[] {
  const filters = c.filters || [];
  return records.filter((r) => {
    for (const f of filters) {
      const sel = state[f.field] || [];
      if (sel.length === 0) continue;
      const val = r[f.field];
      if (f.kind === 'min') {
        if (!(Number(val) >= Number(sel[0]))) return false;
      } else if (!sel.includes(String(val))) {
        return false;
      }
    }
    return true;
  });
}

export function facetOptions(records: NormalizedRecord[], field: string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of records) {
    const v = r[field];
    if (v != null && v !== '') m.set(String(v), (m.get(String(v)) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
