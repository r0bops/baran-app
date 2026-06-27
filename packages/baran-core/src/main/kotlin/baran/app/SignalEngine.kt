package baran.app

import baran.crypto.BaranIdentity
import baran.crypto.Crypto
import baran.domain.AttestationRecord
import baran.domain.FoldResult
import baran.domain.ReportRecord
import baran.trust.VerificationFold

/**
 * The field app's record authoring core — pure, deterministic, no Android deps.
 * Builds and signs real `report` / `attestation` records with the device's
 * Ed25519 identity, exactly as the frozen contract specifies, and folds trust via
 * the same vector-locked [VerificationFold] every other Baran target uses.
 *
 * A `TimeProvider` is injected (never `System.currentTimeMillis()` directly) so the
 * HLC and sequence behaviour are testable and the P0-3 clock rules hold.
 */
class SignalEngine(
    val identity: BaranIdentity,
    private val now: () -> Long = { System.currentTimeMillis() },
    startSeq: Int = 0,
) {
    private var seq = startSeq

    /** Per-author monotonic counter (equivocation detector). Shared across reports
     *  and attestations so an id is never reused. */
    @Synchronized
    private fun nextSeq(): Int = ++seq

    fun currentSeq(): Int = seq

    /** Author + sign a report (sos / victim_found / need / hazard / missing_person / status). */
    fun createReport(
        type: String,
        prio: Int,
        payload: Map<String, Any?>,
        subjectId: String? = null,
    ): ReportRecord {
        val s = nextSeq()
        val t = now()
        val base = ReportRecord(
            id = "${identity.deviceId}:$s",
            authorId = identity.deviceId,
            authorSeq = s,
            type = type,
            prio = prio,
            createdWallMs = t,
            hlc = "$t.0.${identity.deviceId}",
            payload = payload,
            subjectId = subjectId,
        )
        val signed = Crypto.sign(unsigned(base.toMap()), identity)
        return base.copy(contentHash = signed.contentHash, sig = signed.sig)
    }

    /** Author + sign an attestation against [target]. */
    fun createAttestation(
        target: ReportRecord,
        attType: String,
        fact: String,
        proof: Map<String, Any?>? = null,
    ): AttestationRecord {
        val s = nextSeq()
        val t = now()
        val base = AttestationRecord(
            id = "${identity.deviceId}:a:$s",
            claimerId = identity.deviceId,
            claimerSeq = s,
            targetReportId = target.id,
            targetContentHash = target.contentHash,
            attType = attType,
            fact = fact,
            prio = target.prio,
            hlc = "$t.0.${identity.deviceId}",
            proof = proof,
        )
        val signed = Crypto.sign(unsigned(base.toMap()), identity)
        return base.copy(contentHash = signed.contentHash, sig = signed.sig)
    }

    /** Build an `on_site` proximity proof from a precise location inside the report's cell. */
    fun onSiteProof(myLat: Double, myLng: Double, reportPlusCode: String): Map<String, Any?> {
        val myCoarse = baran.geo.PlusCode.coarse(baran.geo.PlusCode.encode(myLat, myLng))
        val targetCoarse = baran.geo.PlusCode.coarse(reportPlusCode)
        return mapOf(
            "type" to "pluscode",
            "match" to (myCoarse == targetCoarse),
            "plus_code8" to myCoarse,
        )
    }

    companion object {
        private fun unsigned(m: Map<String, Any?>): Map<String, Any?> =
            m.filterKeys { it != "content_hash" && it != "sig" }

        /** Compute trust for a report + its attestations using the shared fold. */
        fun fold(
            report: ReportRecord,
            attestations: List<AttestationRecord>,
            identities: Map<String, ByteArray>,
        ): FoldResult = VerificationFold.fold(
            report.toMap(),
            attestations.map { it.toMap() },
            identities,
            report.subjectId,
        )
    }
}
