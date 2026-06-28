// baran-core-ts: verification fold
import { verify, verifyPayload } from './crypto.js';
const TIER = {
    reported: 1,
    corroborated: 2,
    on_site: 3,
    device_confirmed: 4,
    self_confirmed: 5,
};
const REV_TIER = {};
for (const [k, v] of Object.entries(TIER))
    REV_TIER[v] = k;
export function fold(report, attestations, identities, subjectDeviceId) {
    const reporterId = report.author_id;
    const reporterPub = identities[reporterId];
    if (!reporterPub || !verify(report, reporterPub)) {
        return { tier: 0, tierName: 'invalid', verified: false, disputed: false, locationVerified: false, note: 'report signature invalid' };
    }
    const valid = attestations.filter(a => {
        const cid = a.claimer_id;
        const cp = identities[cid];
        return cp && verify(a, cp);
    });
    let tier = TIER.reported;
    let locationVerified = false;
    const reporter = reporterId;
    // verified flag
    const verifiedFlag = valid.some(a => a.claimer_id === reporter && (a.att_type === 'affirm' || a.att_type === 'resolve'));
    // Corroborated: >= 2 DISTINCT keys (not reporter)
    const corroborators = new Set(valid.filter(a => a.claimer_id !== reporter &&
        ['corroborate', 'on_site', 'device_confirm'].includes(a.att_type) &&
        a.fact === 'still_needs_help').map(a => a.claimer_id));
    if (corroborators.size >= 2)
        tier = Math.max(tier, TIER.corroborated);
    // On-site
    if (valid.some(a => a.att_type === 'on_site' && a.proof && a.proof.match === true)) {
        tier = Math.max(tier, TIER.on_site);
    }
    // Device-confirmed (P0-2 corroborated-location)
    const dcs = valid.filter(a => a.att_type === 'device_confirm' && a.proof && a.proof.subject_sig);
    for (const a of dcs) {
        const proof = a.proof;
        const rp = proof.response_payload;
        if (!rp)
            continue;
        const subjectSig = proof.subject_sig;
        const spub = subjectDeviceId ? identities[subjectDeviceId] : null;
        const subjOk = spub && rp &&
            verifyPayload(rp, subjectSig, spub) &&
            rp.subject_id === subjectDeviceId &&
            rp.attestor_id === a.claimer_id;
        if (!subjOk)
            continue;
        const ownCode = proof.own_plus_code8 || '';
        const attCode = rp.attestor_plus_code || '';
        const subjectAnchored = attCode !== '' && attCode === ownCode;
        const sameCellAttestors = new Set(dcs.filter(x => {
            const xp = x.proof;
            return (xp?.own_plus_code8 || '') === ownCode;
        }).map(x => x.claimer_id));
        if (subjectAnchored || sameCellAttestors.size >= 2) {
            tier = Math.max(tier, TIER.device_confirmed);
            locationVerified = true;
        }
        else {
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
    const facts = new Set(valid.filter(a => ['on_site', 'corroborate', 'resolve'].includes(a.att_type))
        .map(a => a.fact));
    const disputed = facts.has('still_needs_help') && (facts.has('found_safe') || facts.has('false'));
    const tierName = REV_TIER[tier] || 'reported';
    return { tier, tierName, verified: verifiedFlag, disputed, locationVerified: locationVerified };
}
