// SOS Venezuela 2026 public API client.
// External, community-sourced, UNSIGNED data — kept strictly separate from VenRescate's
// cryptographically-signed records and never folded into a trust tier. Attribution
// ("SOS Venezuela 2026") is required by the source. https://sosvenezuela2026.com/docs
const SOS_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SOS_BASE ||
  'https://sosvenezuela2026.com';

export interface ExternalReport {
  id: string;
  title: string;
  category: string;
  severity: string; // verde | amarillo | naranja | rojo
  lat: number;
  lng: number;
  municipio: string;
  parroquia?: string;
  verification?: string;
  description?: string;
  source_url?: string;
  site_class?: string; // NEHRP soil class B–E
  peopleTrapped?: number | null;
  created_at?: string;
}

export interface PersonStats {
  missing: number;
  found: number;
  total: number;
}

export async function fetchExternalReports(signal?: AbortSignal): Promise<ExternalReport[]> {
  const res = await fetch(`${SOS_BASE}/api/reports`, { signal });
  if (!res.ok) throw new Error(`SOS VE API ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>[];
  return raw
    .filter((r) => typeof r.lat_pub === 'number' && typeof r.lng_pub === 'number')
    .map((r) => ({
      id: String(r.id),
      title: (r.title as string) || '(sin título)',
      category: (r.category as string) || 'unknown',
      severity: (r.severity as string) || 'amarillo',
      lat: r.lat_pub as number,
      lng: r.lng_pub as number,
      municipio: (r.municipio as string) || '',
      parroquia: r.parroquia as string | undefined,
      verification: r.verification as string | undefined,
      description: r.description as string | undefined,
      source_url: r.source_url as string | undefined,
      site_class: r.site_class as string | undefined,
      peopleTrapped: (r.people_trapped_count as number | null) ?? null,
      created_at: r.created_at as string | undefined,
    }));
}

// These throw on failure so the cache layer (fetchCached) can fall back to local data.
export async function fetchPersonStats(signal?: AbortSignal): Promise<PersonStats | null> {
  const res = await fetch(`${SOS_BASE}/api/persons/stats`, { signal });
  if (!res.ok) throw new Error(`persons/stats ${res.status}`);
  return (await res.json()) as PersonStats;
}

export interface DamageReport {
  id: string;
  zona: string;
  municipio: string;
  building_type: string;
  note?: string;
  validations: number;
  habitable_votes: number;
  inhabitable_votes: number;
  uncertain_votes: number;
  created_at?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  published_at?: string;
}

export async function fetchDamageRecent(signal?: AbortSignal): Promise<DamageReport[]> {
  const res = await fetch(`${SOS_BASE}/api/damage/recent`, { signal });
  if (!res.ok) throw new Error(`damage/recent ${res.status}`);
  return (await res.json()) as DamageReport[];
}

export async function fetchNews(signal?: AbortSignal): Promise<NewsItem[]> {
  const res = await fetch(`${SOS_BASE}/api/news`, { signal });
  if (!res.ok) throw new Error(`news ${res.status}`);
  return (await res.json()) as NewsItem[];
}

export const SOS_ATTRIBUTION = 'Fuente pública · SOS Venezuela 2026';
