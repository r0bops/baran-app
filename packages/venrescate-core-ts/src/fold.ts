// venrescate-core-ts: verification fold
import { verify, verifyPayload } from './crypto.js';

const TIER: Record<string, number> = {
  reported: 1,
  corroborated: 2,
  on_site: 3,
  device_confirmed: 4,
  self_confirmed: 5,
};
const REV_TIER: Record<number, string> = {};
for (const [k, v] of Object.entries(TIER)) REV_TIER[v] = k;

export interface FoldResult {
  tier: number;
  tierName: string;
  verified: boolean;
  disputed: boolean;
  locationVerified: boolean;
  note?: string;
}

export function fold(
  report: Record<string, unknown>,
  attestations: Record<string, unknown>[],
  identities: Record<string, Uint8Array>,
  subjectDeviceId: string | null
): FoldResult {
  const reporterId = report.author_id as string;
  const reporterPub = identities[reporterId];
  if (!reporterPub || !verify(report, reporterPub)) {
    return { tier: 0, tierName: 'invalid', verified: false, disputed: false, locationVerified: false, note: 'report signature invalid' };
  }

  const valid = attestations.filter(a => {
    const cid = a.claimer_id as string;
    const cp = identities[cid];
    return cp && verify(a, cp);
  });

  let tier = TIER.reported;
  let locationVerified = false;
  const reporter = reporterId;

  // verified flag
  const verifiedFlag = valid.some(a =>
    a.claimer_id === reporter && (a.att_type === 'affirm' || a.att_type === 'resolve')
  );

  // Corroborated: >= 2 DISTINCT keys (not reporter)
  const corroborators = new Set(
    valid.filter(a =>
      a.claimer_id !== reporter &&
      ['corroborate', 'on_site', 'device_confirm'].includes(a.att_type as string) &&
      a.fact === 'still_needs_help'
    ).map(a => a.claimer_id as string)
  );
  if (corroborators.size >= 2) tier = Math.max(tier, TIER.corroborated);

  // On-site
  if (valid.some(a => a.att_type === 'on_site' && a.proof && (a.proof as any).match === true)) {
    tier = Math.max(tier, TIER.on_site);
  }

  // Device-confirmed (P0-2 corroborated-location)
  const dcs = valid.filter(a =>
    a.att_type === 'device_confirm' && a.proof && (a.proof as any).subject_sig
  );
  for (const a of dcs) {
    const proof = a.proof as any;
    const rp = proof.response_payload;
    if (!rp) continue;
    const subjectSig = proof.subject_sig as string;
    const spub = subjectDeviceId ? identities[subjectDeviceId] : null;

    const subjOk = spub && rp &&
      verifyPayload(rp, subjectSig, spub) &&
      rp.subject_id === subjectDeviceId &&
      rp.attestor_id === a.claimer_id;

    if (!subjOk) continue;

    const ownCode = proof.own_plus_code8 as string || '';
    const attCode = (rp.attestor_plus_code as string) || '';
    const subjectAnchored = attCode !== '' && attCode === ownCode;

    const sameCellAttestors = new Set(
      dcs.filter(x => {
        const xp = x.proof as any;
        return (xp?.own_plus_code8 || '') === ownCode;
      }).map(x => x.claimer_id as string)
    );

    if (subjectAnchored || sameCellAttestors.size >= 2) {
      tier = Math.max(tier, TIER.device_confirmed);
      locationVerified = true;
    } else {
      tier = Math.max(tier, TIER.on_site);
      locationVerified = false;
    }
  }

  // Self-confirmed
  if (subjectDeviceId && valid.some(a => a.att_type === 'self_confirm' && a.claimer_id === subjectDeviceId)) {
    tier = Math.max(tier, TIER.self_confirmed);
    locationVerified = true;
  }

  // Disputed
  const facts = new Set(
    valid.filter(a => ['on_site', 'corroborate', 'resolve'].includes(a.att_type as string))
      .map(a => a.fact as string)
  );
  const disputed = facts.has('still_needs_help') && (facts.has('found_safe') || facts.has('false'));

  const tierName = REV_TIER[tier] || 'reported';
  return { tier, tierName, verified: verifiedFlag, disputed, locationVerified: locationVerified };
}
