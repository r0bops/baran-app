// Real geographic map (MapLibre GL). VenRescate's signed records are circles coloured by
// type with a trust-tier ring. Overlay sources (SOS Venezuela, USGS, …) are a SEPARATE
// layer of per-point coloured dots — external/unsigned data, never a trust tier.
// Basemap is pluggable via VITE_BASEMAP_PMTILES; with none set it renders a blank style.
import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VenRescateRecord } from '../lib/api';
import type { OverlayPoint } from '../lib/overlays';
import { decodePlusCode } from '../lib/plus-code';

let pmtilesRegistered = false;
function registerPmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

const BASEMAP = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BASEMAP_PMTILES;
const CARACAS: [number, number] = [-66.9036, 10.4806];

const TYPE_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'type'],
  'sos', '#ef4444', 'victim_found', '#f97316', 'missing_person', '#eab308',
  'need', '#22c55e', 'hazard', '#a855f7', '#6b7280',
];
const TIER_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'tier'],
  0, '#ef4444', 1, '#f59e0b', 2, '#f97316', 3, '#3b82f6', 4, '#22c55e', 5, '#8b5cf6', '#64748b',
];

function toFeatureCollection(records: VenRescateRecord[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const rec of records) {
    const p = rec.record.payload as Record<string, unknown> | undefined;
    const ll = decodePlusCode((p?.plus_code as string) || (p?.plus_code8 as string));
    if (!ll) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
      properties: { id: rec.record.id, type: rec.record.type ?? 'status', tier: rec.meta.tier, disputed: rec.meta.disputed },
    });
  }
  return { type: 'FeatureCollection', features };
}

function overlayFC(points: OverlayPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { title: p.title, subtitle: p.subtitle || '', source: p.sourceLabel, color: p.color, radius: p.radius },
    })),
  };
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function blankStyle(): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification['sources'] = {};
  const layers: maplibregl.LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
  ];
  if (BASEMAP) {
    sources.basemap = { type: 'vector', url: `pmtiles://${BASEMAP}` };
    layers.push({ id: 'land', type: 'fill', source: 'basemap', 'source-layer': 'land', paint: { 'fill-color': '#111a2e' } });
  }
  return { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources, layers };
}

export function MapView({
  records,
  overlay,
  selectedId,
  onSelect,
  picking,
  draft,
  onPick,
}: {
  records: VenRescateRecord[];
  overlay?: OverlayPoint[];
  selectedId?: string | null;
  onSelect: (rec: VenRescateRecord) => void;
  picking?: boolean;
  draft?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fittedRef = useRef(false);
  const ovFittedRef = useRef(false);
  const recordsRef = useRef(records);
  const overlayRef = useRef(overlay);
  const onSelectRef = useRef(onSelect);
  const pickingRef = useRef(picking);
  const onPickRef = useRef(onPick);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  recordsRef.current = records;
  overlayRef.current = overlay;
  onSelectRef.current = onSelect;
  pickingRef.current = picking;
  onPickRef.current = onPick;

  function fitToCoords(map: MlMap, coords: [number, number][]) {
    if (!coords.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const c of coords) b.extend(c);
    map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
  }

  // Overlay sources carry real coordinates, so they win the initial view (VenRescate's test
  // vectors use synthetic Plus Codes). Records-only fit is the fallback.
  function fitData(map: MlMap) {
    const ov = overlayRef.current;
    if (ov && ov.length && !ovFittedRef.current) {
      fitToCoords(map, ov.map((p) => [p.lng, p.lat] as [number, number]));
      ovFittedRef.current = true;
      fittedRef.current = true;
      return;
    }
    if (!fittedRef.current && !(ov && ov.length)) {
      const coords: [number, number][] = [];
      for (const rec of recordsRef.current) {
        const p = rec.record.payload as Record<string, unknown> | undefined;
        const ll = decodePlusCode((p?.plus_code as string) || (p?.plus_code8 as string));
        if (ll) coords.push([ll.lng, ll.lat]);
      }
      if (coords.length) { fitToCoords(map, coords); fittedRef.current = true; }
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;
    registerPmtiles();
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: containerRef.current, style: blankStyle(), center: CARACAS, zoom: 11, attributionControl: false });
    } catch {
      containerRef.current.innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#64748b">Mapa no disponible (WebGL)</div>';
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Overlay layer (external sources), drawn beneath the signed records.
      map.addSource('overlay', { type: 'geojson', data: overlayFC(overlayRef.current ?? []) });
      map.addLayer({
        id: 'overlay-pts', type: 'circle', source: 'overlay',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['get', 'radius'],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#0b1220',
          'circle-stroke-width': 1,
        },
      });

      map.addSource('records', { type: 'geojson', data: toFeatureCollection(records), cluster: true, clusterRadius: 45, clusterMaxZoom: 14 });
      map.addLayer({
        id: 'clusters', type: 'circle', source: 'records', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#1e3a5f', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 30] },
      });
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'records', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 }, paint: { 'text-color': '#e0f2fe' },
      });
      map.addLayer({
        id: 'points', type: 'circle', source: 'records', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': TYPE_COLOR, 'circle-radius': ['case', ['==', ['get', 'type'], 'sos'], 9, 7], 'circle-stroke-color': TIER_COLOR, 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'points-selected', type: 'circle', source: 'records', filter: ['==', ['get', 'id'], selectedId ?? '__none__'],
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 15, 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'points-disputed', type: 'symbol', source: 'records',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'disputed'], true]],
        layout: { 'text-field': '!', 'text-size': 12 }, paint: { 'text-color': '#ffffff' },
      });

      map.on('click', 'points', (e) => {
        if (pickingRef.current) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const rec = id ? recordsRef.current.find((r) => r.record.id === id) : undefined;
        if (rec) onSelectRef.current(rec);
      });
      map.on('click', 'overlay-pts', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font:12px system-ui;color:#0f172a"><b>${esc(p.title)}</b>` +
            (p.subtitle ? `<br>${esc(p.subtitle)}` : '') +
            `<br><span style="color:#64748b">Fuente: ${esc(p.source)}</span></div>`,
          )
          .addTo(map);
      });
      map.on('click', 'clusters', (e) => {
        if (pickingRef.current) return;
        const f = e.features?.[0];
        const clusterId = f?.properties?.cluster_id;
        const src = map.getSource('records') as GeoJSONSource;
        if (clusterId != null && src.getClusterExpansionZoom) {
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: (f!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
        }
      });
      // Pick mode: any map click sets the new report's location.
      map.on('click', (e) => {
        if (pickingRef.current && onPickRef.current) onPickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
      for (const layer of ['points', 'clusters', 'overlay-pts']) {
        map.on('mouseenter', layer, () => { if (!pickingRef.current) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { if (!pickingRef.current) map.getCanvas().style.cursor = ''; });
      }
      fitData(map);
    });

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('records') as GeoJSONSource | undefined;
      if (!src) return;
      src.setData(toFeatureCollection(records));
      fitData(map);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [records]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('overlay') as GeoJSONSource | undefined;
      if (!src) return;
      src.setData(overlayFC(overlay ?? []));
      fitData(map);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [overlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('points-selected')) {
      map.setFilter('points-selected', ['==', ['get', 'id'], selectedId ?? '__none__']);
    }
  }, [selectedId]);

  // Crosshair cursor while picking; centre on the draft pin when the form opens.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
    if (picking && draft) map.easeTo({ center: [draft.lng, draft.lat], zoom: Math.max(map.getZoom(), 12), duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  // Draft pin for the report being created (draggable to refine).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!draft) {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }
    if (!draftMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 4px #ef444466;cursor:grab';
      const marker = new maplibregl.Marker({ element: el, draggable: true });
      marker.on('dragend', () => { const ll = marker.getLngLat(); onPickRef.current?.(ll.lat, ll.lng); });
      marker.setLngLat([draft.lng, draft.lat]).addTo(map);
      draftMarkerRef.current = marker;
    } else {
      draftMarkerRef.current.setLngLat([draft.lng, draft.lat]);
    }
  }, [draft]);

  const ovCount = overlay?.length ?? 0;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: '#64748b', padding: '0 0 8px 2px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>🗺️ MapLibre{BASEMAP ? ' · mapa base PMTiles' : ' · sin mapa base'}</span>
        <span>⬤ firmados (VenRescate)</span>
        {ovCount > 0 && <span style={{ color: '#94a3b8' }}>○ {ovCount} puntos de capas externas</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e293b' }} />
    </div>
  );
}
