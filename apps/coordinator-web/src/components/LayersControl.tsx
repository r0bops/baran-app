// The overlay-source list, grouped by provider/category (see config/sources.ts):
// one toggle per external API, with a colour swatch and a live point count.
interface SourceMeta {
  id: string;
  label: string;
  swatch: string;
  attribution: string;
}
interface GroupMeta {
  id: string;
  label: string;
  sources: SourceMeta[];
}

export function LayersControl({
  groups,
  enabled,
  counts,
  onToggle,
}: {
  groups: GroupMeta[];
  enabled: Record<string, boolean>;
  counts: Record<string, number>;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
      <span style={{ color: '#94a3b8' }}>Capas:</span>
      {groups.map((g, i) => (
        <span
          key={g.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: i > 0 ? 14 : 0,
            borderLeft: i > 0 ? '1px solid #334155' : undefined,
          }}
        >
          <span style={{ color: '#64748b', fontWeight: 600 }}>{g.label}</span>
          {g.sources.map((s) => (
            <label key={s.id} title={s.attribution} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!enabled[s.id]} onChange={(e) => onToggle(s.id, e.target.checked)} />
              <span style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.swatch, display: 'inline-block' }} />
              <span style={{ color: enabled[s.id] ? '#cbd5e1' : '#475569' }}>{s.label}</span>
              <span style={{ color: '#475569' }}>({counts[s.id] ?? 0})</span>
            </label>
          ))}
        </span>
      ))}
    </div>
  );
}
