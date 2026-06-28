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
import { fetchPersonStats, fetchDamageRecent, fetchNews, type PersonStats, type DamageReport, type NewsItem } from './lib/sosvzla';
import { fetchCached } from './lib/cache';
import { SOURCES, SOURCE_GROUPS } from './config/sources';
import { loadSource, applySourceFilters, toPoints, type NormalizedRecord } from './lib/sourceEngine';
import type { OverlayPoint } from './lib/overlays';
import { CommunityPanel } from './components/CommunityPanel';
import { IncidentList } from './components/IncidentList';
import { RecordCard, RecordDetail } from './components/RecordCard';
import { BadgeRow } from './components/Badges';
// MapLibre is heavy and only needed on the Mapa view — load it on demand.
const MapView = lazy(() => import('./components/MapView').then((m) => ({ default: m.MapView })));
import { CoordinatorPanel } from './components/CoordinatorPanel';
import { AttestationTimeline } from './components/AttestationTimeline';
import { Filters, DEFAULT_FILTERS, applyFilters, type FilterState } from './components/Filters';
import { LayersControl } from './components/LayersControl';
import { SourceFilters } from './components/SourceFilters';
import { CreateReportModal } from './components/CreateReportModal';
import { statusUpdatesFor, STATUS_META } from './lib/status';

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
  // Config-driven overlay sources (see config/sources.ts), cached locally for offline.
  const [rawBySource, setRawBySource] = useState<Record<string, NormalizedRecord[]>>({});
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(() => {
    const def: Record<string, boolean> = {};
    for (const s of SOURCES) def[s.id] = s.enabledByDefault;
    return { ...def, ...(loadJSON<Record<string, boolean>>('baran.layers') || {}) };
  });
  const [filterState, setFilterState] = useState<Record<string, Record<string, string[]>>>(() => loadJSON('baran.filters') || {});
  const [offlineTs, setOfflineTs] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draftLocation, setDraftLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [personStats, setPersonStats] = useState<PersonStats | null>(null);
  const [damage, setDamage] = useState<DamageReport[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
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

  // Load every configured external source + the SOS-VE panels, cached for offline.
  useEffect(() => {
    const ctrl = new AbortController();
    const noteCache = (fromCache: boolean, ts: number | null) => {
      if (fromCache && ts) setOfflineTs((prev) => Math.max(prev ?? 0, ts));
    };
    for (const s of SOURCES) {
      loadSource(s, ctrl.signal)
        .then((c) => { setRawBySource((prev) => ({ ...prev, [s.id]: c.data })); noteCache(c.fromCache, c.ts); })
        .catch(() => {});
    }
    fetchCached('sosve:persons', () => fetchPersonStats(ctrl.signal), null).then((c) => { setPersonStats(c.data); noteCache(c.fromCache, c.ts); });
    fetchCached('sosve:damage', () => fetchDamageRecent(ctrl.signal), []).then((c) => { setDamage(c.data); noteCache(c.fromCache, c.ts); });
    fetchCached('sosve:news', () => fetchNews(ctrl.signal), []).then((c) => { setNews(c.data); noteCache(c.fromCache, c.ts); });
    return () => ctrl.abort();
  }, []);

  useEffect(() => saveJSON('baran.layers', enabledLayers), [enabledLayers]);
  useEffect(() => saveJSON('baran.filters', filterState), [filterState]);

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
  const { overlayPoints, layerCounts } = useMemo(() => {
    const pts: OverlayPoint[] = [];
    const counts: Record<string, number> = {};
    for (const s of SOURCES) {
      const raw = rawBySource[s.id] || [];
      const filteredRecs = applySourceFilters(raw, s, filterState[s.id] || {});
      counts[s.id] = filteredRecs.length;
      if (enabledLayers[s.id]) pts.push(...toPoints(filteredRecs, s));
    }
    return { overlayPoints: pts, layerCounts: counts };
  }, [rawBySource, enabledLayers, filterState]);

  const activeFilterSources = SOURCES.filter(
    (s) => enabledLayers[s.id] && (s.filters?.length ?? 0) > 0 && (rawBySource[s.id]?.length ?? 0) > 0,
  );

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
        <MapView
          records={filtered}
          overlay={overlayPoints}
          selectedId={selectedId}
          onSelect={(r) => openDetail(r.record.id as string)}
          picking={picking}
          draft={showCreate ? draftLocation : null}
          onPick={(la, lo) => { setDraftLocation({ lat: la, lng: lo }); setPicking(false); }}
        />
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

  const statusUpdates = detail ? statusUpdatesFor(detail.record.record.id as string, records) : [];

  const detailInner = detail && (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <BadgeRow meta={detail.record.meta} />
        <button onClick={() => { setSelectedId(null); setDetail(null); }} style={{ ...ghost, flexShrink: 0 }}>✕</button>
      </div>
      <RecordDetail data={detail.record} />
      {statusUpdates.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <h4 style={{ color: '#a78bfa', fontSize: 13, margin: '4px 0 8px' }}>Estado operativo</h4>
          {statusUpdates.slice().reverse().map((u, i) => {
            const m = STATUS_META[u.status] || { label: u.status, color: '#94a3b8' };
            return (
              <div key={i} style={{ padding: '6px 10px', borderRadius: 6, backgroundColor: '#0f172a', border: '1px solid #1e293b', borderLeft: `3px solid ${m.color}`, marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: m.color, fontWeight: 600, fontSize: 12 }}>🚩 {m.label}</span>
                  <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }}>{u.claimedBy.slice(0, 12)}</span>
                </div>
                {u.note && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{u.note}</div>}
              </div>
            );
          })}
        </div>
      )}
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
          <button
            onClick={() => { setDraftLocation({ lat: 10.4806, lng: -66.9036 }); setShowCreate(true); }}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            ＋ Reporte
          </button>
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
        <LayersControl
          groups={SOURCE_GROUPS}
          enabled={enabledLayers}
          counts={layerCounts}
          onToggle={(id, on) => setEnabledLayers((e) => ({ ...e, [id]: on }))}
        />
        {personStats && (
          <span style={{ color: '#475569' }} title="Directorio público de personas">👤 {personStats.missing} buscadas · {personStats.found} halladas</span>
        )}
        {offlineTs && (
          <span style={{ color: '#f59e0b' }} title="Mostrando datos en caché local (sin conexión a una fuente)">
            ● caché {new Date(offlineTs).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {(view === 'map' || view === 'records') && <Filters value={filters} onChange={setFilters} />}
      </div>

      {/* Per-source filter bars (generated from each source's config) */}
      {centerView === 'map' && activeFilterSources.length > 0 && (
        <div style={{ padding: '5px 20px', backgroundColor: '#13203a', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activeFilterSources.map((s) => (
            <SourceFilters
              key={s.id}
              config={s}
              records={rawBySource[s.id] || []}
              state={filterState[s.id] || {}}
              onChange={(st) => setFilterState((prev) => ({ ...prev, [s.id]: st }))}
            />
          ))}
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
            {detail ? detailInner : <CommunityPanel damage={damage} news={news} />}
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

      {showCreate && (
        <CreateReportModal
          visible={!picking}
          location={draftLocation}
          onLocationChange={(la, lo) => setDraftLocation({ lat: la, lng: lo })}
          onRequestPick={() => { setView('map'); setPicking(true); }}
          onClose={() => { setShowCreate(false); setPicking(false); }}
          onCreated={(id) => { setShowCreate(false); setPicking(false); flash('Reporte creado'); loadReports().then(() => openDetail(id)); loadIncidents(); }}
        />
      )}

      {picking && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e3a5f', border: '1px solid #38bdf8', color: '#e0f2fe', padding: '8px 16px', borderRadius: 8, fontSize: 13, zIndex: 60, display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 4px 16px #0008' }}>
          📍 Toca el mapa para ubicar el reporte (o arrastra el pin)
          <button onClick={() => setPicking(false)} style={{ ...ghost, padding: '3px 8px' }}>Listo</button>
        </div>
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

function loadJSON<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

const panel: React.CSSProperties = { backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', overflow: 'hidden', height: '100%' };
const ghost: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', backgroundColor: '#1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
function tab(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', borderRadius: 6, border: active ? '1px solid #3b82f6' : '1px solid #334155', backgroundColor: active ? '#1e3a5f' : '#1e293b', color: active ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
}
