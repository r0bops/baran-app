// Map overlay sources. Each source is a DIFFERENT external API normalised into a
// common OverlayPoint, so the coordinator can stack several feeds on the map. All
// external/overlay data is unsigned and kept separate from Baran's signed records.
import type { ExternalReport } from './sosvzla';

export interface OverlayPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  color: string; // per-point marker colour
  radius: number;
  sourceId: string;
  sourceLabel: string;
  source_url?: string;
}

export interface OverlayMeta {
  id: string;
  label: string;
  swatch: string; // legend colour
  attribution: string;
}

export const OVERLAY_META: OverlayMeta[] = [
  { id: 'sosve_reports', label: 'SOS VE · Reportes', swatch: '#eab308', attribution: 'SOS Venezuela 2026' },
  { id: 'usgs_quakes', label: 'USGS · Sismos', swatch: '#22d3ee', attribution: 'USGS Earthquake Hazards Program' },
];

const SEVERITY_COLOR: Record<string, string> = { rojo: '#ef4444', naranja: '#f97316', amarillo: '#eab308', verde: '#22c55e' };

/** SOS Venezuela damage reports → overlay points (coloured by severity). */
export function reportsToOverlay(reports: ExternalReport[]): OverlayPoint[] {
  return reports.map((r) => ({
    id: `sosve:${r.id}`,
    lat: r.lat,
    lng: r.lng,
    title: r.title,
    subtitle: [r.municipio, r.category].filter(Boolean).join(' · '),
    color: SEVERITY_COLOR[r.severity] || '#eab308',
    radius: 4,
    sourceId: 'sosve_reports',
    sourceLabel: 'SOS Venezuela 2026',
    source_url: r.source_url,
  }));
}

function usgsColor(mag: number): string {
  if (mag >= 6) return '#7f1d1d';
  if (mag >= 5) return '#dc2626';
  if (mag >= 4) return '#f97316';
  if (mag >= 3) return '#eab308';
  return '#22d3ee';
}

// Venezuela bounding box for filtering the global feed.
const VE_BBOX = { minLat: 0, maxLat: 14, minLng: -74, maxLng: -59 };

/** USGS M2.5+ earthquakes (past 30 days), filtered to the Venezuela region. */
export async function loadUsgsQuakes(signal?: AbortSignal): Promise<OverlayPoint[]> {
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson', { signal });
    if (!res.ok) return [];
    const g = (await res.json()) as { features: Array<{ id: string; geometry: { coordinates: number[] }; properties: { mag: number; place: string; url: string } }> };
    return g.features
      .filter((f) => {
        const [lng, lat] = f.geometry.coordinates;
        return lat >= VE_BBOX.minLat && lat <= VE_BBOX.maxLat && lng >= VE_BBOX.minLng && lng <= VE_BBOX.maxLng;
      })
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const mag = f.properties.mag || 0;
        return {
          id: `usgs:${f.id}`,
          lat,
          lng,
          title: `Sismo M${mag.toFixed(1)}`,
          subtitle: f.properties.place || '',
          color: usgsColor(mag),
          radius: Math.max(4, mag * 2.2),
          sourceId: 'usgs_quakes',
          sourceLabel: 'USGS · Sismos',
          source_url: f.properties.url,
        };
      });
  } catch {
    return [];
  }
}
