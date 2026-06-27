// Real geographic map (MapLibre GL). Pins are placed at the lat/lng decoded from
// each record's Plus Code, clustered, coloured by type with a trust-tier ring,
// click-to-select. The coordinator is online, so the basemap is pluggable: set
// VITE_BASEMAP_PMTILES to a self-hosted .pmtiles for offline vector tiles; with
// none configured it renders a zero-network blank style (data layers only).
import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { BaranRecord } from '../lib/api';
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

function toFeatureCollection(records: BaranRecord[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const rec of records) {
    const p = rec.record.payload as Record<string, unknown> | undefined;
    const ll = decodePlusCode((p?.plus_code as string) || (p?.plus_code8 as string));
    if (!ll) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
      properties: {
        id: rec.record.id,
        type: rec.record.type ?? 'status',
        tier: rec.meta.tier,
        disputed: rec.meta.disputed,
      },
    });
  }
  return { type: 'FeatureCollection', features };
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
  selectedId,
  onSelect,
}: {
  records: BaranRecord[];
  selectedId?: string | null;
  onSelect: (rec: BaranRecord) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    registerPmtiles();
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: blankStyle(),
        center: CARACAS,
        zoom: 11,
        attributionControl: false,
      });
    } catch {
      // WebGL unavailable (e.g. headless without a GL backend) — leave a hint.
      containerRef.current.innerHTML =
        '<div style="height:100%;display:grid;place-items:center;color:#64748b">Mapa no disponible (WebGL)</div>';
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource('records', {
        type: 'geojson',
        data: toFeatureCollection(records),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 14,
      });

      map.addLayer({
        id: 'clusters', type: 'circle', source: 'records', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1e3a5f',
          'circle-stroke-color': '#38bdf8',
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 15, 30],
        },
      });
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'records', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 },
        paint: { 'text-color': '#e0f2fe' },
      });

      map.addLayer({
        id: 'points', type: 'circle', source: 'records', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': TYPE_COLOR,
          'circle-radius': ['case', ['==', ['get', 'type'], 'sos'], 9, 7],
          'circle-stroke-color': TIER_COLOR,
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'points-selected', type: 'circle', source: 'records',
        filter: ['==', ['get', 'id'], selectedId ?? '__none__'],
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 15, 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'points-disputed', type: 'symbol', source: 'records',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'disputed'], true]],
        layout: { 'text-field': '!', 'text-size': 12 }, paint: { 'text-color': '#ffffff' },
      });

      map.on('click', 'points', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const rec = id ? records.find((r) => r.record.id === id) : undefined;
        if (rec) onSelectRef.current(rec);
      });
      map.on('click', 'clusters', (e) => {
        const f = e.features?.[0];
        const clusterId = f?.properties?.cluster_id;
        const src = map.getSource('records') as GeoJSONSource;
        if (clusterId != null && src.getClusterExpansionZoom) {
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: (f!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
        }
      });
      for (const layer of ['points', 'clusters']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
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
      const fc = toFeatureCollection(records);
      src.setData(fc);
      if (!fittedRef.current && fc.features.length > 0) {
        const b = new maplibregl.LngLatBounds();
        for (const f of fc.features) b.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]);
        map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
        fittedRef.current = true;
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [records]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('points-selected')) {
      map.setFilter('points-selected', ['==', ['get', 'id'], selectedId ?? '__none__']);
    }
  }, [selectedId]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: '#64748b', padding: '0 0 8px 2px' }}>
        🗺️ MapLibre · pines desde Plus Codes{BASEMAP ? ' · mapa base PMTiles' : ' · sin mapa base (offline)'}
      </div>
      <div ref={containerRef} style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e293b' }} />
    </div>
  );
}
