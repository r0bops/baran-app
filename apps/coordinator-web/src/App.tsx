import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  fetchRecords,
  fetchRecord,
  fetchIncidents,
  registerCoordinator,
  connectWebSocket,
  type BaranRecord,
  type Incident,
} from './lib/api';
import { ensureAuth, initCoordinator } from './lib/coordinator';
import { toCSV, toGeoJSON, downloadFile } from './lib/export';
import { fetchExternalReports, fetchPersonStats, type ExternalReport, type PersonStats } from './lib/sosvzla';
import { IncidentList } from './components/IncidentList';
import { RecordCard, RecordDetail } from './components/RecordCard';
import { BadgeRow } from './components/Badges';
// MapLibre is heavy and only needed on the Mapa view — load it on demand.
const MapView = lazy(() => import('./components/MapView').then((m) => ({ default: m.MapView })));
import { CoordinatorPanel } from './components/CoordinatorPanel';
import { AttestationTimeline } from './components/AttestationTimeline';
import { Filters, DEFAULT_FILTERS, applyFilters, type FilterState } from './components/Filters';
import { ExternalFilters, DEFAULT_EXT_FILTERS, applyExternalFilters, type ExtFilterState } from './components/ExternalFilters';

type View = 'map' | 'incidents' | 'records';

export default function App() {
  const [view, setView] = useState<View>('map');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [records, setRecords] = useState<BaranRecord[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ record: BaranRecord; attestations: BaranRecord[] } | null>(null);
  const [wsLive, setWsLive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [coordId, setCoordId] = useState<string>('');
  const [role, setRole] = useState<string>('');
  // SOS Venezuela 2026 public feed — external, unsigned, shown as a distinct layer.
  const [external, setExternal] = useState<ExternalReport[]>([]);
  const [showExternal, setShowExternal] = useState(true);
  const [extFilters, setExtFilters] = useState<ExtFilterState>(DEFAULT_EXT_FILTERS);
  const [personStats, setPersonStats] = useState<PersonStats | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Desktop (Tauri) and wide browsers get a 3-column layout; narrow gets tabs.
  const wide = useWide();

  const flash = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadReports = useCallback(async () => {
    const data = await fetchRecords({ kind: 'report', limit: '100' });
    setRecords(data);
  }, []);

  const loadIncidents = useCallback(async () => {
    setIncidents(await fetchIncidents());
  }, []);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const d = await fetchRecord(id);
      setDetail({ record: { record: d.record, meta: d.meta }, attestations: d.attestations });
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const id = await initCoordinator();
        setCoordId(id.deviceId);
        const r = await ensureAuth();
        if (r) setRole(r);
        else await registerCoordinator(id.publicKeyB64u); // stub path: no auth
      } catch {
        /* ignore auth/registration errors; reads still work */
      }
      loadReports().catch(() => flash('error de conexión'));
      loadIncidents().catch(() => {});
    })();
  }, [loadReports, loadIncidents, flash]);

  // Pull the SOS Venezuela 2026 public feed (best-effort; failures are non-fatal).
  useEffect(() => {
    const ctrl = new AbortController();
    fetchExternalReports(ctrl.signal).then(setExternal).catch(() => {});
    fetchPersonStats(ctrl.signal).then(setPersonStats).catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    return connectWebSocket(
      (event, data) => {
        if (event === 'record:created') {
          const rec = (data as { record?: { type?: string; kind?: string } })?.record;
          flash(`nuevo ${rec?.kind === 'attestation' ? 'atestación' : rec?.type || 'registro'}`);
          loadReports();
          loadIncidents();
          if (selectedId) openDetail(selectedId);
        }
      },
      setWsLive
    );
  }, [flash, loadReports, loadIncidents, selectedId, openDetail]);

  const filtered = useMemo(() => applyFilters(records, filters), [records, filters]);
  const filteredExternal = useMemo(() => applyExternalFilters(external, extFilters), [external, extFilters]);

  const onActed = useCallback(
    (m: string) => {
      flash(m);
      loadReports();
      loadIncidents();
      if (selectedId) openDetail(selectedId);
    },
    [flash, loadReports, loadIncidents, selectedId, openDetail]
  );

  const exportMenu = (
    <div style={{ display: 'flex', gap: 6 }}>
      <button title="Exportar CSV con procedencia (firmas, hashes, tier)" style={ghost} onClick={() => downloadFile('baran-records.csv', toCSV(filtered), 'text/csv')}>
        ⬇ CSV
      </button>
      <button title="Exportar GeoJSON con procedencia" style={ghost} onClick={() => downloadFile('baran-records.geojson', toGeoJSON(filtered), 'application/geo+json')}>
        ⬇ GeoJSON
      </button>
    </div>
  );

  // In the 3-column layout, incidents is a permanent rail, so the center shows map/records.
  const centerView = wide && view === 'incidents' ? 'records' : view;
  const mapOrRecords =
    centerView === 'map' ? (
      <Suspense fallback={<div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#64748b' }}>Cargando mapa…</div>}>
        <MapView records={filtered} external={showExternal ? filteredExternal : []} selectedId={selectedId} onSelect={(r) => openDetail(r.record.id as string)} />
      </Suspense>
    ) : (
      <div>
        {filtered.map((rec) => (
          <RecordCard key={rec.record.id as string} data={rec} selected={selectedId === rec.record.id} onClick={() => openDetail(rec.record.id as string)} />
        ))}
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Sin reportes que coincidan</div>}
      </div>
    );

  const incidentsList = (
    <IncidentList incidents={incidents} onSelect={(inc) => { setFilters({ ...filters, type: inc.type }); setView('records'); }} />
  );

  const detailInner = detail && (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <BadgeRow meta={detail.record.meta} />
        <button onClick={() => { setSelectedId(null); setDetail(null); }} style={{ ...ghost, flexShrink: 0 }}>✕</button>
      </div>
      <RecordDetail data={detail.record} />
      <div style={{ padding: '0 16px 16px' }}>
        <h4 style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Atestaciones ({detail.attestations.length})</h4>
        <AttestationTimeline attestations={detail.attestations} />
      </div>
      <CoordinatorPanel target={detail.record} onActed={onActed} />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#0a0f1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ padding: '10px 20px', backgroundColor: '#1a1a2e', borderBottom: '1px solid #16213e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#38bdf8' }}>Baran · Coordinación</h1>
          <span style={{ fontSize: 11, color: '#64748b' }}>Rescate offline-first · es-VE</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {((wide ? ['map', 'records'] : ['map', 'incidents', 'records']) as View[]).map((v) => (
            <button key={v} onClick={() => { setView(v); }} style={tab((wide ? centerView : view) === v)}>
              {v === 'map' ? '🗺️ Mapa' : v === 'incidents' ? '📊 Incidentes' : '📋 Registros'}
            </button>
          ))}
          {exportMenu}
        </div>
      </header>

      <div style={{ padding: '6px 20px', backgroundColor: '#16213e', fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: wsLive ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
          {wsLive ? 'en vivo' : 'reconectando…'}
        </span>
        <span title="Tu identidad de coordinador (Ed25519, generada en el navegador)">
          👤 coordinador <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{coordId.slice(0, 12) || '…'}</span>
          {role && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 6, backgroundColor: '#312e81', color: '#c7d2fe', fontSize: 10 }}>{role}</span>}
        </span>
        <span style={{ color: '#475569' }}>{filtered.length} de {records.length} firmados</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Reportes públicos de SOS Venezuela 2026 (sin firmar)">
          <input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} />
          <span style={{ color: '#eab308' }}>
            • {filteredExternal.length}{filteredExternal.length !== external.length ? `/${external.length}` : ''} públicos (SOS VE)
          </span>
        </label>
        {personStats && (
          <span style={{ color: '#475569' }} title="Directorio público de personas">👤 {personStats.missing} buscadas · {personStats.found} halladas</span>
        )}
        {(view === 'map' || view === 'records') && <Filters value={filters} onChange={setFilters} />}
      </div>

      {/* Public-feed filter bar (map view) */}
      {showExternal && centerView === 'map' && external.length > 0 && (
        <div style={{ padding: '5px 20px', backgroundColor: '#13203a', borderTop: '1px solid #1e293b' }}>
          <ExternalFilters reports={external} value={extFilters} onChange={setExtFilters} />
        </div>
      )}

      {toast && (
        <div style={{ position: 'absolute', top: 92, right: 24, backgroundColor: '#1e3a5f', border: '1px solid #38bdf8', color: '#e0f2fe', padding: '8px 14px', borderRadius: 8, fontSize: 13, zIndex: 10, boxShadow: '0 4px 16px #0008' }}>
          {toast}
        </div>
      )}

      {wide ? (
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 12, gap: 12 }}>
          <div style={{ ...panel, width: 300, flexShrink: 0, overflow: 'auto', padding: 12 }}>
            <h4 style={{ margin: '0 0 8px', color: '#94a3b8', fontSize: 13 }}>📊 Incidentes</h4>
            {incidentsList}
          </div>
          <div style={{ ...panel, flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>{mapOrRecords}</div>
          <div style={{ ...panel, width: 420, flexShrink: 0, overflow: 'auto' }}>
            {detail ? detailInner : (
              <div style={{ padding: 24, color: '#64748b', fontSize: 13 }}>
                Selecciona una señal para ver su procedencia y responder.
              </div>
            )}
          </div>
        </main>
      ) : (
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 12, gap: 12 }}>
          <div style={{ ...panel, width: detail ? '46%' : '100%', overflow: 'auto', padding: 12 }}>
            {view === 'incidents' ? incidentsList : mapOrRecords}
          </div>
          {detail && <div style={{ ...panel, flex: 1, overflow: 'auto' }}>{detailInner}</div>}
        </main>
      )}
    </div>
  );
}

/** True on wide viewports (desktop / Tauri) — drives the 3-column layout. */
function useWide(): boolean {
  const [wide, setWide] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1200 : true);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return wide;
}

const panel: React.CSSProperties = { backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', overflow: 'hidden', height: '100%' };
const ghost: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', backgroundColor: '#1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
function tab(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', borderRadius: 6, border: active ? '1px solid #3b82f6' : '1px solid #334155', backgroundColor: active ? '#1e3a5f' : '#1e293b', color: active ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
}
