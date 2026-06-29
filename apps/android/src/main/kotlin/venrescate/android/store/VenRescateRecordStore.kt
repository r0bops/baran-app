package venrescate.android.store

import venrescate.crypto.Crypto
import venrescate.domain.FoldResult
import venrescate.trust.VerificationFold

/**
 * Local signed-record store on Android.
 * Implements the SignedRecordStore interface from venrescate-core.
 * All records verified before insertion (per P0-2).
 */
class VenRescateRecordStore(
    private val identities: Map<String, ByteArray> // deviceId -> publicKeyRaw
) {
    // In production: Room database with these tables:
    //   reports(signed_json, verified, received_monotonic_ms, boot_count, reach, ttl_ms)
    //   attestations(signed_json, verified, target_report_id, received_monotonic_ms, boot_count, reach, ttl_ms)

    private val reports = mutableListOf<Map<String, Any?>>()
    private val attestations = mutableListOf<Map<String, Any?>>()

    fun putReport(record: Map<String, Any?>) {
        val authorId = record["author_id"] as? String ?: return
        val pubRaw = identities[authorId] ?: return

        if (Crypto.verify(record, pubRaw)) {
            reports.add(record)
        }
        // Forged/invalid signatures silently dropped
    }

    fun putAttestation(record: Map<String, Any?>) {
        val claimerId = record["claimer_id"] as? String ?: return
        val pubRaw = identities[claimerId] ?: return

        if (Crypto.verify(record, pubRaw)) {
            attestations.add(record)
        }
    }

    fun getReport(id: String): Map<String, Any?>? =
        reports.find { it["id"] == id }

    fun getAttestationsFor(reportId: String): List<Map<String, Any?>> =
        attestations.filter { it["target_report_id"] == reportId }

    fun fold(reportId: String, subjectDeviceId: String? = null): FoldResult {
        val report = getReport(reportId) ?: return FoldResult(0, "invalid", false, false, false, "report not found")
        val atts = getAttestationsFor(reportId)
        return VerificationFold.fold(report, atts, identities, subjectDeviceId)
    }
}
