// Coordinator filters — kind, priority, trust tier, reach, disputed-only.
import type { BaranRecord } from '../lib/api';

export interface FilterState {
  type: string; // '' = all
  prioMax: number; // include prio <= prioMax
  tierMin: number; // include tier >= tierMin
  reach: string; // '' = all
  disputedOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  type: '',
  prioMax: 5,
  tierMin: 0,
  reach: '',
  disputedOnly: false,
};

const TYPES = ['sos', 'victim_found', 'missing_person', 'need', 'hazard', 'status'];

export function applyFilters(records: BaranRecord[], f: FilterState): BaranRecord[] {
  return records.filter((b) => {
    const r = b.record;
    if (f.type && r.type !== f.type) return false;
    if (typeof r.prio === 'number' && r.prio > f.prioMax) return false;
    if (b.meta.tier < f.tierMin) return false;
    if (f.reach && b.meta.reach?.level !== f.reach) return false;
    if (f.disputedOnly && !b.meta.disputed) return false;
    return true;
  });
}

const selStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
};

export function Filters({ value, onChange }: { value: FilterState; onChange: (f: FilterState) => void }) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
      <select style={selStyle} value={value.type} onChange={(e) => set({ type: e.target.value })}>
        <option value="">Todos los tipos</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        prio ≤
        <select style={selStyle} value={value.prioMax} onChange={(e) => set({ prioMax: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>P{p}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        confianza ≥
        <select style={selStyle} value={value.tierMin} onChange={(e) => set({ tierMin: Number(e.target.value) })}>
          <option value={0}>cualquiera</option>
          <option value={2}>corroborado</option>
          <option value={3}>en sitio</option>
          <option value={4}>dispositivo</option>
          <option value={5}>autoconfirmado</option>
        </select>
      </label>

      <select style={selStyle} value={value.reach} onChange={(e) => set({ reach: e.target.value })}>
        <option value="">Todo alcance</option>
        <option value="in_mesh">en la red</option>
        <option value="bridged">llegó a internet</option>
        <option value="anchored">anclado</option>
      </select>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={value.disputedOnly} onChange={(e) => set({ disputedOnly: e.target.checked })} />
        solo disputados
      </label>
    </div>
  );
}
