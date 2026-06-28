// Author a brand-new report from the coordinator console. Signed locally with the
// coordinator's Ed25519 key, POSTed, and tagged online-origin (lower trust until
// verified in-zone) — same honest rules as any coordinator-authored record.
import { useState } from 'react';
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

export function CreateReportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState('sos');
  const [prio, setPrio] = useState(0);
  const [lat, setLat] = useState('10.4806');
  const [lng, setLng] = useState('-66.9036');
  const [note, setNote] = useState('');
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickType(t: string) {
    setType(t);
    setPrio(TYPES.find((x) => x.value === t)?.prio ?? 2);
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
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: '#000a', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: '92vw', backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20, color: '#e2e8f0' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#38bdf8' }}>Nuevo reporte</h3>
          <button onClick={onClose} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>✕</button>
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
          <div style={{ width: 110 }}>
            <label style={lbl}>Prioridad</label>
            <select style={inputStyle} value={prio} onChange={(e) => setPrio(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>P{p}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Latitud</label>
            <input style={inputStyle} value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Longitud</label>
            <input style={inputStyle} value={lng} onChange={(e) => setLng(e.target.value)} />
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

        <button
          onClick={submit}
          disabled={busy}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontSize: 14 }}
        >
          {busy ? 'Firmando…' : 'Crear · firmar y enviar'}
        </button>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 3 };
