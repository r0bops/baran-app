// Filters for the SOS Venezuela 2026 public feed (applied client-side to the fetched
// reports). Facet options (municipios, categories) are derived from the live data.
import { useMemo } from 'react';
import type { ExternalReport } from '../lib/sosvzla';

export interface ExtFilterState {
  severities: string[]; // empty = all
  category: string; // '' = all
  municipio: string; // '' = all
  verification: string; // '' = all
}

export const DEFAULT_EXT_FILTERS: ExtFilterState = { severities: [], category: '', municipio: '', verification: '' };

export function applyExternalFilters(reports: ExternalReport[], f: ExtFilterState): ExternalReport[] {
  return reports.filter((r) => {
    if (f.severities.length && !f.severities.includes(r.severity)) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.municipio && r.municipio !== f.municipio) return false;
    if (f.verification && (r.verification || 'unverified') !== f.verification) return false;
    return true;
  });
}

const SEVERITIES = ['rojo', 'naranja', 'amarillo', 'verde'];
const SEVERITY_COLOR: Record<string, string> = { rojo: '#ef4444', naranja: '#f97316', amarillo: '#eab308', verde: '#22c55e' };

const CATEGORY_LABELS: Record<string, string> = {
  damaged_building: 'Edificio dañado',
  collapsed_building: 'Edificio colapsado',
  trapped_people: 'Personas atrapadas',
  shelter: 'Refugio',
  aid_point: 'Punto de ayuda',
  gas_leak: 'Fuga de gas',
  medical_need: 'Necesidad médica',
  water_point: 'Punto de agua',
};
const VERIFICATION_LABELS: Record<string, string> = {
  official_verified: 'Oficial',
  community_confirmed: 'Comunidad',
  unverified: 'Sin verificar',
};

const selStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 12,
};

export function ExternalFilters({
  reports,
  value,
  onChange,
}: {
  reports: ExternalReport[];
  value: ExtFilterState;
  onChange: (f: ExtFilterState) => void;
}) {
  const municipios = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports) if (r.municipio) m.set(r.municipio, (m.get(r.municipio) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [reports]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const r of reports) if (r.category) s.add(r.category);
    return [...s];
  }, [reports]);

  const set = (patch: Partial<ExtFilterState>) => onChange({ ...value, ...patch });
  const toggleSev = (s: string) =>
    set({ severities: value.severities.includes(s) ? value.severities.filter((x) => x !== s) : [...value.severities, s] });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
      <span style={{ color: '#eab308' }}>Públicos:</span>

      <span style={{ display: 'inline-flex', gap: 4 }}>
        {SEVERITIES.map((s) => {
          const on = value.severities.length === 0 || value.severities.includes(s);
          const c = SEVERITY_COLOR[s];
          return (
            <button
              key={s}
              onClick={() => toggleSev(s)}
              title={`severidad: ${s}`}
              style={{
                padding: '2px 8px',
                borderRadius: 10,
                fontSize: 11,
                cursor: 'pointer',
                textTransform: 'capitalize',
                border: `1px solid ${c}`,
                backgroundColor: value.severities.includes(s) ? c : 'transparent',
                color: value.severities.includes(s) ? '#0b1220' : on ? c : '#475569',
                opacity: value.severities.length === 0 ? 0.85 : 1,
              }}
            >
              {s}
            </button>
          );
        })}
      </span>

      <select style={selStyle} value={value.category} onChange={(e) => set({ category: e.target.value })}>
        <option value="">Toda categoría</option>
        {categories.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
        ))}
      </select>

      <select style={selStyle} value={value.municipio} onChange={(e) => set({ municipio: e.target.value })}>
        <option value="">Todo municipio</option>
        {municipios.map(([m, n]) => (
          <option key={m} value={m}>{m} ({n})</option>
        ))}
      </select>

      <select style={selStyle} value={value.verification} onChange={(e) => set({ verification: e.target.value })}>
        <option value="">Toda verificación</option>
        {Object.entries(VERIFICATION_LABELS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
    </div>
  );
}
