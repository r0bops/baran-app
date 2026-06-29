import type { VenRescateRecord } from '../lib/api';

const TYPE_ICONS: Record<string, string> = {
  sos: '🚨',
  victim_found: '✅',
  need: '📦',
  hazard: '⚠️',
  missing_person: '🔍',
  status: '📋',
};

const PRIO_COLORS: Record<number, string> = {
  0: '#ef4444', 1: '#f97316', 2: '#eab308', 3: '#3b82f6', 4: '#6b7280', 5: '#9ca3af',
};

export function RecordCard({ data, selected, onClick }: { data: VenRescateRecord; selected?: boolean; onClick: () => void }) {
  const r = data.record;
  const type = (r.type as string) || 'unknown';
  const prio = (r.prio as number) ?? 5;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px', borderRadius: 8, cursor: 'pointer',
        backgroundColor: selected ? '#1e3a5f' : '#1e293b',
        border: selected ? '2px solid #3b82f6' : '1px solid #334155',
        marginBottom: 8, transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>{TYPE_ICONS[type] || '📄'}</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>
              {type === 'sos' ? 'SOS' : type === 'missing_person' ? 'Persona Desaparecida' : type.replace(/_/g, ' ')}
            </span>
            <span style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              backgroundColor: PRIO_COLORS[prio] + '33', color: PRIO_COLORS[prio],
            }}>
              P{prio}
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>
            {(r.payload as any)?.note || (r.payload as any)?.msg || (r.payload as any)?.name || '(sin nota)'}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {(r.id as string)?.split(':')[0]?.substring(0, 8)} · seq {(r.author_seq as number)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RecordDetail({ data }: { data: VenRescateRecord }) {
  const r = data.record;
  const payload = r.payload as Record<string, unknown> | undefined;

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 12px 0', color: '#f1f5f9', fontSize: 16 }}>
        {TYPE_ICONS[r.type as string] || ''} {(r.type as string)?.replace(/_/g, ' ')}
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 13 }}>
        <span style={{ color: '#64748b' }}>ID:</span>
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{r.id as string}</span>

        <span style={{ color: '#64748b' }}>Autor:</span>
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{(r.author_id as string)?.substring(0, 12)}</span>

        <span style={{ color: '#64748b' }}>Prioridad:</span>
        <span style={{ color: PRIO_COLORS[r.prio as number] || '#94a3b8' }}>P{r.prio as number}</span>

        <span style={{ color: '#64748b' }}>HLC:</span>
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{r.hlc as string}</span>

        <span style={{ color: '#64748b' }}>Content Hash:</span>
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{r.content_hash as string}</span>
      </div>

      {payload && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Datos:</div>
          <pre style={{
            backgroundColor: '#0f172a', padding: 10, borderRadius: 6,
            fontSize: 11, color: '#94a3b8', overflow: 'auto', maxHeight: 200,
            fontFamily: 'monospace', margin: 0,
          }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
