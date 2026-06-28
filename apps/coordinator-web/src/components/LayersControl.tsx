// The overlay-source list: one toggle per external API, with a colour swatch and a
// live point count. Sources come from config/sources.ts.
interface SourceMeta {
  id: string;
  label: string;
  swatch: string;
  attribution: string;
}

export function LayersControl({
  sources,
  enabled,
  counts,
  onToggle,
}: {
  sources: SourceMeta[];
  enabled: Record<string, boolean>;
  counts: Record<string, number>;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
      <span style={{ color: '#94a3b8' }}>Capas:</span>
      {sources.map((s) => (
        <label key={s.id} title={s.attribution} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!enabled[s.id]} onChange={(e) => onToggle(s.id, e.target.checked)} />
          <span style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.swatch, display: 'inline-block' }} />
          <span style={{ color: enabled[s.id] ? '#cbd5e1' : '#475569' }}>{s.label}</span>
          <span style={{ color: '#475569' }}>({counts[s.id] ?? 0})</span>
        </label>
      ))}
    </div>
  );
}
