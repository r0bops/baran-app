// Chronological attestation timeline with proof details.
// Disputes render red, resolutions green — the trust history is auditable.
import type { VenRescateRecord } from '../lib/api';

const ATT_LABELS: Record<string, string> = {
  corroborate: 'corrobora',
  on_site: 'en sitio',
  device_confirm: 'confirma dispositivo',
  self_confirm: 'autoconfirma',
  affirm: 'afirma',
  resolve: 'resuelve',
  dispute: 'disputa',
};

const FACT_LABELS: Record<string, string> = {
  still_needs_help: 'necesita ayuda',
  found_safe: 'a salvo',
  present: 'presente',
  false: 'falsa alarma',
};

function colorFor(att: Record<string, unknown>): string {
  const type = att.att_type as string;
  if (type === 'dispute' || att.fact === 'false') return '#dc2626';
  if (type === 'resolve' || att.fact === 'found_safe') return '#16a34a';
  if (type === 'on_site' || type === 'device_confirm' || type === 'self_confirm') return '#3b82f6';
  return '#475569';
}

function ProofDetail({ proof }: { proof: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  if (proof.type) rows.push(['tipo', String(proof.type)]);
  if (proof.match != null) rows.push(['coincide', proof.match ? 'sí' : 'no']);
  if (proof.plus_code8) rows.push(['celda', String(proof.plus_code8)]);
  if (proof.own_plus_code8) rows.push(['celda atestador', String(proof.own_plus_code8)]);
  const rp = proof.response_payload as Record<string, unknown> | undefined;
  if (rp) {
    if (rp.subject_rssi != null) rows.push(['RSSI sujeto', `${rp.subject_rssi} dBm`]);
    if (rp.attestor_plus_code) rows.push(['celda firmada por sujeto', String(rp.attestor_plus_code)]);
  }
  if (proof.subject_sig) rows.push(['firma del sujeto', String(proof.subject_sig).slice(0, 16) + '…']);
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 10.5 }}>
      {rows.map(([k, v]) => (
        <span key={k} style={{ display: 'contents' }}>
          <span style={{ color: '#64748b' }}>{k}</span>
          <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v}</span>
        </span>
      ))}
    </div>
  );
}

export function AttestationTimeline({ attestations }: { attestations: VenRescateRecord[] }) {
  if (attestations.length === 0) {
    return <div style={{ color: '#64748b', fontSize: 12, padding: '4px 0' }}>Sin atestaciones aún.</div>;
  }
  const sorted = [...attestations].sort((a, b) => {
    const ha = (a.record.hlc as string) || '';
    const hb = (b.record.hlc as string) || '';
    return ha.localeCompare(hb);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map((att) => {
        const r = att.record;
        const color = colorFor(r);
        const type = (r.att_type as string) || (r.type as string);
        const fact = r.fact as string;
        return (
          <div
            key={r.id as string}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              backgroundColor: '#0f172a',
              borderLeft: `3px solid ${color}`,
              border: '1px solid #1e293b',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                {ATT_LABELS[type] || type}
                {fact ? <span style={{ color, fontWeight: 400 }}> · {FACT_LABELS[fact] || fact}</span> : null}
              </span>
              {att.meta?.origin === 'online' && (
                <span style={{ color: '#a855f7', fontSize: 10 }}>en línea</span>
              )}
            </div>
            <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 10, marginTop: 2 }}>
              {(r.claimer_id as string)?.substring(0, 12)} · seq {r.claimer_seq as number}
            </div>
            {r.proof ? <ProofDetail proof={r.proof as Record<string, unknown>} /> : null}
          </div>
        );
      })}
    </div>
  );
}
