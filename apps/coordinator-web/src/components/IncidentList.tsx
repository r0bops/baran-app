import type { Incident } from '../lib/api';

const TIER_COLORS: Record<number, string> = {
  0: '#ef4444',
  1: '#f59e0b',
  2: '#f97316',
  3: '#3b82f6',
  4: '#22c55e',
  5: '#8b5cf6',
};

const TYPE_LABELS: Record<string, string> = {
  sos: 'SOS',
  victim_found: 'Víctima Encontrada',
  need: 'Necesidad',
  hazard: 'Peligro',
  missing_person: 'Persona Desaparecida',
  status: 'Estado',
};

function formatCell(cell: string): string {
  if (cell === 'unknown') return 'Ubicación desconocida';
  return cell;
}

export function IncidentList({ incidents, onSelect }: { incidents: Incident[]; onSelect: (incident: Incident) => void }) {
  // Group by cell
  const byCell: Record<string, Incident[]> = {};
  for (const inc of incidents) {
    if (!byCell[inc.cell]) byCell[inc.cell] = [];
    byCell[inc.cell].push(inc);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(byCell).map(([cell, incs]) => (
        <div key={cell} style={{ padding: '12px 16px', borderRadius: 8, backgroundColor: '#1e293b', border: '1px solid #334155' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
            📍 {formatCell(cell)}
          </div>
          {incs.map(inc => (
            <div
              key={inc.id}
              onClick={() => onSelect(inc)}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                backgroundColor: '#0f172a', border: '1px solid #1e293b',
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>
                  {TYPE_LABELS[inc.type] || inc.type}
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {inc.count} reporte{inc.count !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8, backgroundColor: '#334155', color: TIER_COLORS[inc.maxTier] || '#94a3b8' }}>
                  Tier {inc.maxTier}
                </span>
                <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8, backgroundColor: '#334155', color: inc.maxReach === 'bridged' ? '#06b6d4' : '#6b7280' }}>
                  {inc.maxReach === 'bridged' ? 'llegó a internet' : 'en la red'}
                </span>
                {inc.disputed && (
                  <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8, backgroundColor: '#7f1d1d', color: '#fca5a5' }}>
                    disputado
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
