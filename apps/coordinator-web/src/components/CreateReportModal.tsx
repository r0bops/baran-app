// Author a brand-new report. A NON-BLOCKING floating panel so the map stays
// interactive: the draft pin is draggable and a map click moves it. Signed locally
// with the coordinator's Ed25519 key, POSTed, tagged online-origin. lat/lng → Plus
// Code on submit.
import { useEffect, useState } from 'react';
import { postRecord } from '../lib/api';
import { buildReport } from '../lib/coordinator';
import { encodePlusCode } from '../lib/plus-code';

const TYPES: Array<{ value: string; label: string; prio: number }> = [
  { value: 'sos', label: 'SOS', prio: 0 },
  { value: 'victim_found', label: 'Víctima encontrada', prio: 2 },
  { value: 'missing_person', label: 'Persona desaparecida', prio: 1 },
  { value: 'need', label: 'Necesidad', prio: 2 },
  { value: 'hazard', label: 'Peligro', prio: 1 },
  { value: 'status', label: 'Estado', prio: 3 },
];

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', backgroundColor: '#0f172a', color: '#e2e8f0',
  border: '1px solid #334155', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit',
};

export function CreateReportModal({
  location,
  onLocationChange,
  onClose,
  onCreated,
}: {
  location: { lat: number; lng: number } | null;
  onLocationChange: (lat: number, lng: number) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [type, setType] = useState('sos');
  const [prio, setPrio] = useState(0);
  const [lat, setLat] = useState(location ? location.lat.toFixed(5) : '10.48060');
  const [lng, setLng] = useState(location ? location.lng.toFixed(5) : '-66.90360');
  const [note, setNote] = useState('');
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync the inputs when the pin is moved (dragged or map-clicked).
  useEffect(() => {
    if (location) {
      setLat(location.lat.toFixed(5));
      setLng(location.lng.toFixed(5));
    }
  }, [location]);

  function pickType(t: string) {
    setType(t);
    setPrio(TYPES.find((x) => x.value === t)?.prio ?? 2);
  }

  function setLatLng(la: string, lo: string) {
    setLat(la);
    setLng(lo);
    const a = parseFloat(la);
    const o = parseFloat(lo);
    if (!isNaN(a) && !isNaN(o)) onLocationChange(a, o);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const la = parseFloat(lat);
      const lo = parseFloat(lng);
      const payload: Record<string, unknown> = {};
      if (note.trim()) payload.note = note.trim();
      const c = parseInt(count, 10);
      if (!isNaN(c)) payload.count = c;
      if (!isNaN(la) && !isNaN(lo)) payload.plus_code = encodePlusCode(la, lo);
      const created = await postRecord(buildReport(type, prio, payload));
      onCreated(created.record.id as string);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', left: 14, top: 150, width: 360, maxWidth: '90vw', maxHeight: 'calc(100vh - 170px)', overflowY: 'auto', backgroundColor: '#0f172a', border: '1px solid #38bdf8', borderRadius: 12, padding: 18, color: '#e2e8f0', zIndex: 40, boxShadow: '0 10px 40px #000a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#38bdf8' }}>Nuevo reporte</h3>
        <button onClick={onClose} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12, padding: '6px 8px', backgroundColor: '#13203a', borderRadius: 6 }}>
        📍 Arrastra el pin rojo o toca el mapa para ajustar la ubicación.
      </div>

      <label style={lbl}>Tipo</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => pickType(t.value)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: type === t.value ? '1px solid #3b82f6' : '1px solid #334155',
              backgroundColor: type === t.value ? '#1e3a5f' : '#1e293b',
              color: type === t.value ? '#60a5fa' : '#94a3b8',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 90 }}>
          <label style={lbl}>Prioridad</label>
          <select style={inputStyle} value={prio} onChange={(e) => setPrio(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>P{p}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Latitud</label>
          <input style={inputStyle} value={lat} onChange={(e) => setLatLng(e.target.value, lng)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Longitud</label>
          <input style={inputStyle} value={lng} onChange={(e) => setLatLng(lat, e.target.value)} />
        </div>
      </div>

      <label style={lbl}>Descripción</label>
      <textarea style={{ ...inputStyle, marginBottom: 10, resize: 'vertical' }} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

      {(type === 'need' || type === 'sos') && (
        <>
          <label style={lbl}>Cantidad de personas (opcional)</label>
          <input style={{ ...inputStyle, marginBottom: 10 }} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
        </>
      )}

      {error && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8, fontFamily: 'monospace' }}>✗ {error}</div>}

      <button onClick={submit} disabled={busy} style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontSize: 14 }}>
        {busy ? 'Firmando…' : 'Crear · firmar y enviar'}
      </button>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 3 };
