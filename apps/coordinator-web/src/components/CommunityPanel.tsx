// Side panel for the tabular SOS Venezuela 2026 feeds that have no coordinates:
// community building-damage validations and the news feed. External, unsigned data.
import type { DamageReport, NewsItem } from '../lib/sosvzla';

function stripHtml(s: string): string {
  // Strip complete tags, then drop any unclosed-tag remainder (the SOS news feed
  // truncates summaries mid-anchor, leaving a dangling `<a href="…`).
  return s.replace(/<[^>]*>/g, '').split('<')[0].replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function VoteBar({ d }: { d: DamageReport }) {
  const total = Math.max(1, d.habitable_votes + d.inhabitable_votes + d.uncertain_votes);
  const seg = (n: number, color: string) =>
    n > 0 ? <span style={{ width: `${(n / total) * 100}%`, background: color, display: 'inline-block', height: 6 }} /> : null;
  return (
    <div style={{ display: 'flex', borderRadius: 3, overflow: 'hidden', backgroundColor: '#1e293b', marginTop: 6 }}>
      {seg(d.habitable_votes, '#22c55e')}
      {seg(d.uncertain_votes, '#64748b')}
      {seg(d.inhabitable_votes, '#ef4444')}
    </div>
  );
}

export function CommunityPanel({ damage, news }: { damage: DamageReport[]; news: NewsItem[] }) {
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <h3 style={{ color: '#f1f5f9', fontSize: 15, margin: '0 0 4px' }}>🏚️ Daños recientes ({damage.length})</h3>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Validación comunitaria de estructuras</div>
      {damage.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>Sin datos.</div>}
      {damage.map((d) => (
        <div key={d.id} style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: '#0f172a', border: '1px solid #1e293b', marginBottom: 8 }}>
          <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{d.zona || d.municipio || 'Estructura'}</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>{[d.municipio, d.building_type].filter(Boolean).join(' · ')}</div>
          {d.note && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{d.note.slice(0, 140)}{d.note.length > 140 ? '…' : ''}</div>}
          <VoteBar d={d} />
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 4, display: 'flex', gap: 10 }}>
            <span style={{ color: '#22c55e' }}>habitable {d.habitable_votes}</span>
            <span style={{ color: '#ef4444' }}>inhabitable {d.inhabitable_votes}</span>
            <span>incierto {d.uncertain_votes}</span>
            <span>· {d.validations} validaciones</span>
          </div>
        </div>
      ))}

      <h3 style={{ color: '#f1f5f9', fontSize: 15, margin: '18px 0 10px' }}>📰 Noticias ({news.length})</h3>
      {news.slice(0, 30).map((n) => {
        const summary = n.summary ? stripHtml(n.summary) : '';
        return (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', padding: '8px 12px', borderRadius: 8, backgroundColor: '#0f172a', border: '1px solid #1e293b', marginBottom: 6, textDecoration: 'none' }}
          >
            <div style={{ color: '#cbd5e1', fontSize: 12.5, fontWeight: 600 }}>{n.title}</div>
            <div style={{ color: '#64748b', fontSize: 10.5, marginTop: 2 }}>{n.source}{n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}</div>
            {summary && summary.toLowerCase() !== n.title.toLowerCase() && (
              <div style={{ color: '#475569', fontSize: 11, marginTop: 3 }}>{summary.slice(0, 120)}{summary.length > 120 ? '…' : ''}</div>
            )}
          </a>
        );
      })}

      <div style={{ color: '#475569', fontSize: 10, marginTop: 12, textAlign: 'center' }}>Fuente pública · SOS Venezuela 2026</div>
    </div>
  );
}
