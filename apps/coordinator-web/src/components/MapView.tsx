// Offline schematic map. No basemap tiles, no network — pins are positioned by
// decoding each record's Plus Code and auto-fitting the bounding box. Honest by
// construction: it shows RELATIVE positions from signed coordinates, not a map.
import { useMemo } from 'react';
import type { BaranRecord } from '../lib/api';
import { decodePlusCode } from '../lib/plus-code';

const TYPE_COLORS: Record<string, string> = {
  sos: '#ef4444',
  victim_found: '#f97316',
  missing_person: '#eab308',
  need: '#22c55e',
  hazard: '#a855f7',
  status: '#6b7280',
};

const TIER_RING: Record<number, string> = {
  0: '#ef4444',
  1: '#f59e0b',
  2: '#f97316',
  3: '#3b82f6',
  4: '#22c55e',
  5: '#8b5cf6',
};

interface Pin {
  rec: BaranRecord;
  lat: number;
  lng: number;
}

export function MapView({
  records,
  selectedId,
  onSelect,
}: {
  records: BaranRecord[];
  selectedId?: string | null;
  onSelect: (rec: BaranRecord) => void;
}) {
  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = [];
    for (const rec of records) {
      const p = rec.record.payload as Record<string, unknown> | undefined;
      const code = (p?.plus_code as string) || (p?.plus_code8 as string);
      const ll = decodePlusCode(code);
      if (ll) out.push({ rec, lat: ll.lat, lng: ll.lng });
    }
    return out;
  }, [records]);

  const W = 800;
  const H = 520;
  const PAD = 48;

  const bounds = useMemo(() => {
    if (pins.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of pins) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    }
    // pad degenerate (single point) bounds
    if (maxLat - minLat < 1e-6) { minLat -= 0.001; maxLat += 0.001; }
    if (maxLng - minLng < 1e-6) { minLng -= 0.001; maxLng += 0.001; }
    return { minLat, maxLat, minLng, maxLng };
  }, [pins]);

  function project(lat: number, lng: number): { x: number; y: number } {
    if (!bounds) return { x: W / 2, y: H / 2 };
    const x = PAD + ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (W - 2 * PAD);
    const y = PAD + (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (H - 2 * PAD);
    return { x, y };
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: '#64748b', padding: '0 0 8px 2px' }}>
        🗺️ Mapa esquemático · posiciones decodificadas de Plus Codes · sin mapa base (offline)
      </div>
      <div style={{ flex: 1, backgroundColor: '#0b1220', borderRadius: 8, border: '1px solid #1e293b', overflow: 'hidden' }}>
        {pins.length === 0 ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#475569' }}>
            Sin coordenadas para mostrar
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`v${i}`} x1={PAD + (i * (W - 2 * PAD)) / 8} y1={PAD} x2={PAD + (i * (W - 2 * PAD)) / 8} y2={H - PAD} stroke="#16213e" strokeWidth={1} />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={`h${i}`} x1={PAD} y1={PAD + (i * (H - 2 * PAD)) / 5} x2={W - PAD} y2={PAD + (i * (H - 2 * PAD)) / 5} stroke="#16213e" strokeWidth={1} />
            ))}
            {pins.map((p, i) => {
              const { x, y } = project(p.lat, p.lng);
              const type = (p.rec.record.type as string) || 'status';
              const color = TYPE_COLORS[type] || '#94a3b8';
              const ring = TIER_RING[p.rec.meta.tier] || '#64748b';
              const sel = p.rec.record.id === selectedId;
              const r = p.rec.record.type === 'sos' ? 11 : 8;
              return (
                <g key={(p.rec.record.id as string) || i} onClick={() => onSelect(p.rec)} style={{ cursor: 'pointer' }}>
                  {sel && <circle cx={x} cy={y} r={r + 8} fill="none" stroke="#38bdf8" strokeWidth={2} />}
                  <circle cx={x} cy={y} r={r + 3} fill="none" stroke={ring} strokeWidth={2.5} />
                  <circle cx={x} cy={y} r={r} fill={color} stroke="#0b1220" strokeWidth={1.5} />
                  {p.rec.meta.disputed && (
                    <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="#fff">!</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 2px 0', fontSize: 11, color: '#94a3b8' }}>
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c, display: 'inline-block' }} /> {t}
          </span>
        ))}
        <span style={{ color: '#475569' }}>· anillo = nivel de confianza · ! = disputado</span>
      </div>
    </div>
  );
}
