// Trust tier and reach badges — honest UI, Spanish-first.
// Trust tier and internet reach are TWO SEPARATE AXES and are always shown apart.
import type { RecordMeta } from '../lib/api';

const TIER_COLORS: Record<string, string> = {
  invalid: '#ef4444',
  reported: '#f59e0b',
  corroborated: '#f97316',
  on_site: '#3b82f6',
  device_confirmed: '#22c55e',
  self_confirmed: '#8b5cf6',
};

const TIER_LABELS: Record<string, string> = {
  invalid: 'inválido',
  reported: 'reportado',
  corroborated: 'corroborado',
  on_site: 'en sitio',
  device_confirmed: 'confirmado por dispositivo',
  self_confirmed: 'autoconfirmado',
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  invalid: 'La firma no verifica. No se confía en este registro.',
  reported: 'Un solo reporte firmado. Aún sin verificar.',
  corroborated: 'Dos o más personas independientes confirman la misma situación.',
  on_site: 'Alguien estuvo en el lugar y aportó prueba de proximidad.',
  device_confirmed: 'El dispositivo de la persona afectada confirmó su presencia.',
  self_confirmed: 'La persona afectada confirmó directamente.',
};

const REACH_COLORS: Record<string, string> = {
  in_mesh: '#6b7280',
  bridged: '#06b6d4',
  anchored: '#10b981',
};

const REACH_LABELS: Record<string, string> = {
  in_mesh: 'en la red',
  bridged: 'llegó a internet',
  anchored: 'anclado',
};

const REACH_DESCRIPTIONS: Record<string, string> = {
  in_mesh: 'Solo visible en la malla local. No ha llegado a internet aún.',
  bridged: 'Llegó a internet vía un puente. Visible para coordinadores remotos.',
  anchored: 'Anclado en registro inmutable. Verificación criptográfica permanente.',
};

function Badge({ color, label, title }: { color: string; label: string; title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        backgroundColor: color + '22',
        color,
        fontSize: 12,
        fontWeight: 600,
        border: `1px solid ${color}44`,
        marginRight: 6,
        marginBottom: 4,
        cursor: title ? 'help' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function TierBadge({ meta }: { meta: RecordMeta }) {
  const color = TIER_COLORS[meta.tierName] || '#999';
  const label = TIER_LABELS[meta.tierName] || meta.tierName;
  return <Badge color={color} label={`confianza: ${label}`} title={TIER_DESCRIPTIONS[meta.tierName]} />;
}

export function ReachBadge({ meta }: { meta: RecordMeta }) {
  const level = meta.reach?.level || 'in_mesh';
  const color = REACH_COLORS[level] || '#999';
  const label = REACH_LABELS[level] || level;
  return <Badge color={color} label={`alcance: ${label}`} title={REACH_DESCRIPTIONS[level]} />;
}

export function DisputedBadge() {
  return <Badge color="#dc2626" label="⚠ disputado" title="Testimonios contradictorios. Ambos lados se muestran; nunca se resuelve solo." />;
}

export function VerifiedBadge() {
  return <Badge color="#22c55e" label="✓ afirmado por reportante" title="El reportante original firmó una afirmación/resolución sobre su propio reporte." />;
}

export function LocationVerifiedBadge() {
  return <Badge color="#06b6d4" label="📍 ubicación confirmada" title="La ubicación fue confirmada por anclaje del sujeto o ≥2 atestadores independientes." />;
}

export function OriginOnlineBadge() {
  return <Badge color="#a855f7" label="origen: en línea" title="Autorado en línea por un coordinador. Menor confianza hasta verificarse en zona." />;
}

export function BadgeRow({ meta }: { meta: RecordMeta }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      <TierBadge meta={meta} />
      <ReachBadge meta={meta} />
      {meta.disputed && <DisputedBadge />}
      {meta.verified && <VerifiedBadge />}
      {meta.locationVerified && <LocationVerifiedBadge />}
      {meta.origin === 'online' && <OriginOnlineBadge />}
    </div>
  );
}
