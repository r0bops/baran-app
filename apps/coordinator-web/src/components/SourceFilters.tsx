// Generic filter bar for one overlay source, rendered from its FilterDef[] config.
// chips = multi-select toggles, select = single dropdown (facets from data), min =
// numeric threshold. State is field → selected string values.
import type { SourceConfig } from '../config/sources';
import { facetOptions, type NormalizedRecord } from '../lib/sourceEngine';

const selStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 12,
};

export function SourceFilters({
  config,
  records,
  state,
  onChange,
}: {
  config: SourceConfig;
  records: NormalizedRecord[];
  state: Record<string, string[]>;
  onChange: (s: Record<string, string[]>) => void;
}) {
  const filters = config.filters || [];
  if (!filters.length) return null;
  const set = (field: string, values: string[]) => onChange({ ...state, [field]: values });

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: '#94a3b8' }}>
      <span style={{ color: config.swatch }}>{config.label}:</span>
      {filters.map((f) => {
        const sel = state[f.field] || [];

        if (f.kind === 'chips') {
          const opts = f.order || facetOptions(records, f.field).map(([v]) => v);
          return (
            <span key={f.field} style={{ display: 'inline-flex', gap: 4 }}>
              {opts.map((v) => {
                const on = sel.includes(v);
                const c = f.colors?.[v] || '#64748b';
                return (
                  <button
                    key={v}
                    onClick={() => set(f.field, on ? sel.filter((x) => x !== v) : [...sel, v])}
                    style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
                      border: `1px solid ${c}`, backgroundColor: on ? c : 'transparent',
                      color: on ? '#0b1220' : sel.length === 0 ? c : '#475569',
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </span>
          );
        }

        if (f.kind === 'min') {
          return (
            <label key={f.field} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {f.label}
              <select
                style={selStyle}
                value={sel[0] || '0'}
                onChange={(e) => set(f.field, e.target.value && e.target.value !== '0' ? [e.target.value] : [])}
              >
                {(f.options || []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          );
        }

        // select
        const opts = facetOptions(records, f.field);
        return (
          <select key={f.field} style={selStyle} value={sel[0] || ''} onChange={(e) => set(f.field, e.target.value ? [e.target.value] : [])}>
            <option value="">{f.label}</option>
            {opts.map(([v, n]) => (
              <option key={v} value={v}>{v} ({n})</option>
            ))}
          </select>
        );
      })}
    </div>
  );
}
