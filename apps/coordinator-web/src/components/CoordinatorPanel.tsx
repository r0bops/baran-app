// Coordinator action panel. Every action is signed locally with the coordinator's
// Ed25519 key (in the browser) and POSTed as a real record. Honest framing: a
// coordinator reply is online-origin and only the ORIGINAL reporter's resolve flips
// the "afirmado" flag — the coordinator can never fake a higher trust tier.
import { useState } from 'react';
import type { BaranRecord } from '../lib/api';
import { postRecord } from '../lib/api';
import {
  buildStatusReply,
  buildResolve,
  buildDispute,
  buildCorroborate,
} from '../lib/coordinator';

type Busy = null | string;

export function CoordinatorPanel({
  target,
  onActed,
}: {
  target: BaranRecord;
  onActed: (msg: string) => void;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const r = target.record;
  const info = {
    id: r.id as string,
    content_hash: r.content_hash as string,
    prio: r.prio as number | undefined,
    plus_code: (r.payload as Record<string, unknown> | undefined)?.plus_code as string | undefined,
  };

  async function act(label: string, build: () => Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      const signed = build();
      await postRecord(signed);
      onActed(`${label} firmado y enviado`);
      if (label.startsWith('Responder')) setReply('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const isReport = r.kind === 'report';
  const btn = (bg: string): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    backgroundColor: bg,
    color: '#fff',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    opacity: busy ? 0.6 : 1,
  });

  return (
    <div style={{ padding: 16, borderTop: '1px solid #1e293b' }}>
      <h4 style={{ color: '#38bdf8', fontSize: 13, margin: '0 0 4px' }}>Acciones del coordinador</h4>
      <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 12px' }}>
        Firmado en el navegador con tu clave Ed25519. Se etiqueta como <b>origen: en línea</b>.
      </p>

      {isReport ? (
        <>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Respuesta del coordinador, p. ej. «Equipo SAR en camino, ETA 40 min»"
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              backgroundColor: '#0f172a',
              color: '#e2e8f0',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button
              disabled={!reply.trim() || !!busy}
              onClick={() => act('Responder (status)', () => buildStatusReply(info, reply.trim()))}
              style={btn('#2563eb')}
            >
              📨 Responder
            </button>
            <button disabled={!!busy} onClick={() => act('Corroborar', () => buildCorroborate(info))} style={btn('#f97316')}>
              🤝 Corroborar
            </button>
            <button
              disabled={!!busy}
              onClick={() => act('Resolver (a salvo)', () => buildResolve(info, 'found_safe'))}
              style={btn('#16a34a')}
            >
              ✅ A salvo
            </button>
            <button
              disabled={!!busy}
              onClick={() => act('Resolver (falsa alarma)', () => buildResolve(info, 'false'))}
              style={btn('#64748b')}
            >
              🚫 Falsa alarma
            </button>
            <button disabled={!!busy} onClick={() => act('Disputar', () => buildDispute(info))} style={btn('#dc2626')}>
              ⚠ Disputar
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: '#64748b', fontSize: 12 }}>
          Las acciones se aplican a reportes. Selecciona un reporte para responder.
        </p>
      )}

      {error && (
        <div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12, fontFamily: 'monospace' }}>
          ✗ {error}
        </div>
      )}
    </div>
  );
}
