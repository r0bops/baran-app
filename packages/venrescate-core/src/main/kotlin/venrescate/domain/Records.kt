package venrescate.domain

data class ReportRecord(
    val schemaVersion: Int = 1,
    val kind: String = "report",
    val id: String,
    val authorId: String,
    val authorSeq: Int,
    val type: String,
    val prio: Int,
    val createdWallMs: Long,
    val hlc: String,
    val payload: Map<String, Any?>,
    val subjectId: String? = null,
    val contentHash: String = "",
    val sig: String = ""
) {
    fun toMap(): Map<String, Any?> {
        val m = mutableMapOf<String, Any?>(
            "schema_version" to schemaVersion,
            "kind" to kind,
            "id" to id,
            "author_id" to authorId,
            "author_seq" to authorSeq,
            "type" to type,
            "prio" to prio,
            "created_wall_ms" to createdWallMs,
            "hlc" to hlc,
            "payload" to payload,
            "content_hash" to contentHash,
            "sig" to sig
        )
        if (subjectId != null) m["subject_id"] = subjectId
        return m
    }

    companion object {
        fun fromMap(m: Map<String, Any?>): ReportRecord = ReportRecord(
            schemaVersion = (m["schema_version"] as Number).toInt(),
            kind = m["kind"] as String,
            id = m["id"] as String,
            authorId = m["author_id"] as String,
            authorSeq = (m["author_seq"] as Number).toInt(),
            type = m["type"] as String,
            prio = (m["prio"] as Number).toInt(),
            createdWallMs = (m["created_wall_ms"] as Number).toLong(),
            hlc = m["hlc"] as String,
            payload = m["payload"] as Map<String, Any?>,
            subjectId = m["subject_id"] as? String,
            contentHash = m["content_hash"] as? String ?: "",
            sig = m["sig"] as? String ?: ""
        )
    }
}

data class AttestationRecord(
    val schemaVersion: Int = 1,
    val kind: String = "attestation",
    val id: String,
    val claimerId: String,
    val claimerSeq: Int,
    val targetReportId: String,
    val targetContentHash: String,
    val attType: String,
    val fact: String,
    val prio: Int,
    val hlc: String,
    val proof: Map<String, Any?>? = null,
    val contentHash: String = "",
    val sig: String = ""
) {
    fun toMap(): Map<String, Any?> {
        val m = mutableMapOf<String, Any?>(
            "schema_version" to schemaVersion,
            "kind" to kind,
            "id" to id,
            "claimer_id" to claimerId,
            "claimer_seq" to claimerSeq,
            "target_report_id" to targetReportId,
            "target_content_hash" to targetContentHash,
            "att_type" to attType,
            "fact" to fact,
            "prio" to prio,
            "hlc" to hlc,
            "content_hash" to contentHash,
            "sig" to sig
        )
        if (proof != null) m["proof"] = proof
        return m
    }

    companion object {
        fun fromMap(m: Map<String, Any?>): AttestationRecord = AttestationRecord(
            schemaVersion = (m["schema_version"] as Number).toInt(),
            kind = m["kind"] as String,
            id = m["id"] as String,
            claimerId = m["claimer_id"] as String,
            claimerSeq = (m["claimer_seq"] as Number).toInt(),
            targetReportId = m["target_report_id"] as String,
            targetContentHash = m["target_content_hash"] as String,
            attType = m["att_type"] as String,
            fact = m["fact"] as String,
            prio = (m["prio"] as Number).toInt(),
            hlc = m["hlc"] as String,
            proof = m["proof"] as? Map<String, Any?>,
            contentHash = m["content_hash"] as? String ?: "",
            sig = m["sig"] as? String ?: ""
        )
    }
}

data class FoldResult(
    val tier: Int,
    val tierName: String,
    val verified: Boolean,
    val disputed: Boolean,
    val locationVerified: Boolean,
    val note: String? = null
) {
    fun toMap(): Map<String, Any?> {
        val m = mutableMapOf<String, Any?>(
            "tier" to tier,
            "tierName" to tierName,
            "verified" to verified,
            "disputed" to disputed,
            "location_verified" to locationVerified
        )
        if (note != null) m["note"] = note
        return m
    }
}
