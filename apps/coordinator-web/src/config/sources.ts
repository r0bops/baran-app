// ─────────────────────────────────────────────────────────────────────────────
// Overlay source configuration — the single place to add/remove external APIs.
//
// Sources are organised into GROUPS (by provider/category). Each source declares
// how to FETCH an API, MAP its response to map points, and which FILTERS to expose.
// Add a new API by appending a source to a group (or a new group); no component
// code changes. All overlay data is external/unsigned and rendered as a layer
// separate from VenRescate's signed records.
// ─────────────────────────────────────────────────────────────────────────────

export type FilterKind = 'chips' | 'select' | 'min';

export interface FilterDef {
  field: string; // field on the (flattened) record to filter by
  label: string;
  kind: FilterKind;
  colors?: Record<string, string>; // chips: per-value colour
  order?: string[]; // chips: fixed display order
  options?: Array<{ value: string; label: string }>; // min/select: fixed options (else derived)
}

export type ColorSpec =
  | { field: string; map: Record<string, string>; fallback: string } // enum → colour
  | { magnitude: string }; // numeric field → magnitude colour ramp

export type RadiusSpec = number | { magnitude: string; min: number; scale: number };

export interface SourceConfig {
  id: string;
  label: string;
  url: string;
  format: 'array' | 'geojson';
  attribution: string;
  swatch: string;
  enabledByDefault: boolean;
  // field mapping (names refer to flattened-record keys)
  lat?: string; // array format only (geojson derives lat/lng from geometry)
  lng?: string;
  title?: string; // a field name…
  titleTemplate?: string; // …or a template like "Sismo M${mag}"
  subtitle?: string[]; // fields joined with " · "
  linkField?: string; // field holding an external URL
  color?: ColorSpec;
  radius?: RadiusSpec;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  filters?: FilterDef[];
}

export interface SourceGroup {
  id: string;
  label: string;
  sources: SourceConfig[];
}

const SEVERITY_COLORS: Record<string, string> = { rojo: '#ef4444', naranja: '#f97316', amarillo: '#eab308', verde: '#22c55e' };

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'sosve',
    label: 'SOS Venezuela 2026',
    sources: [
      {
        id: 'sosve_reports',
        label: 'Reportes de daños',
        url: 'https://sosvenezuela2026.com/api/reports',
        format: 'array',
        attribution: 'SOS Venezuela 2026',
        swatch: '#eab308',
        enabledByDefault: true,
        lat: 'lat_pub',
        lng: 'lng_pub',
        title: 'title',
        subtitle: ['municipio', 'category'],
        linkField: 'source_url',
        color: { field: 'severity', map: SEVERITY_COLORS, fallback: '#eab308' },
        radius: 4,
        filters: [
          { field: 'severity', label: 'Severidad', kind: 'chips', colors: SEVERITY_COLORS, order: ['rojo', 'naranja', 'amarillo', 'verde'] },
          { field: 'category', label: 'Categoría', kind: 'select' },
          { field: 'municipio', label: 'Municipio', kind: 'select' },
          { field: 'verification', label: 'Verificación', kind: 'select' },
        ],
      },
    ],
  },
  {
    id: 'seismic',
    label: 'Sismología',
    sources: [
      {
        id: 'usgs_quakes',
        label: 'USGS · Sismos M2.5+',
        url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson',
        format: 'geojson',
        attribution: 'USGS Earthquake Hazards Program',
        swatch: '#22d3ee',
        enabledByDefault: true,
        titleTemplate: 'Sismo M${mag}',
        subtitle: ['place'],
        linkField: 'url',
        color: { magnitude: 'mag' },
        radius: { magnitude: 'mag', min: 4, scale: 2.2 },
        bbox: { minLat: 0, maxLat: 14, minLng: -74, maxLng: -59 },
        filters: [
          {
            field: 'mag',
            label: 'Magnitud ≥',
            kind: 'min',
            options: [
              { value: '0', label: 'todas' },
              { value: '3', label: '3.0' },
              { value: '4', label: '4.0' },
              { value: '5', label: '5.0' },
            ],
          },
        ],
      },
    ],
  },
];

// Flat list used by the engine + filters (the grouping is a UI concern).
export const SOURCES: SourceConfig[] = SOURCE_GROUPS.flatMap((g) => g.sources);
