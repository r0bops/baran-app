package venrescate.trust

import venrescate.crypto.Crypto
import venrescate.domain.FoldResult
import venrescate.schema.CanonicalJson

object VerificationFold {
    val TIER = mapOf(
        "reported" to 1,
        "corroborated" to 2,
        "on_site" to 3,
        "device_confirmed" to 4,
        "self_confirmed" to 5
    )
    private val REV_TIER = TIER.entries.associate { (k, v) -> v to k }

    fun fold(
        report: Map<String, Any?>,
        attestations: List<Map<String, Any?>>,
        identities: Map<String, ByteArray>,
        subjectDeviceId: String?
    ): FoldResult {
        // 1. Signature gate
        val reporterId = report["author_id"] as? String ?: ""
        val reporterPub = identities[reporterId]
        if (reporterPub == null || !Crypto.verify(report, reporterPub)) {
            return FoldResult(0, "invalid", false, false, false, "report signature invalid")
        }
        val valid = attestations.filter { a ->
            val cid = a["claimer_id"] as? String ?: ""
            val cp = identities[cid]
            cp != null && Crypto.verify(a, cp)
        }

        var tier = TIER["reported"]!!
        var locationVerified = false
        val reporter = reporterId

        // verified flag: reporter affirms/resolves their own report
        val verified = valid.any { a ->
            a["claimer_id"] == reporter && (a["att_type"] == "affirm" || a["att_type"] == "resolve")
        }

        // Corroborated: >= 2 DISTINCT keys (not reporter) asserting same primary fact
        val corroborators = valid.filter { a ->
            a["claimer_id"] != reporter &&
            listOf("corroborate", "on_site", "device_confirm").contains(a["att_type"]) &&
            a["fact"] == "still_needs_help"
        }.map { it["claimer_id"] as String }.toSet()
        if (corroborators.size >= 2) tier = maxOf(tier, TIER["corroborated"]!!)

        // On-site: >= 1 valid proximity proof (on_site att with proof.match === true)
        if (valid.any { a ->
            a["att_type"] == "on_site" && a["proof"] != null && (a["proof"] as Map<String, Any?>)["match"] == true
        }) tier = maxOf(tier, TIER["on_site"]!!)

        // Device-confirmed (P0-2 corroborated-location)
        val dcs = valid.filter { a ->
            a["att_type"] == "device_confirm" && a["proof"] != null && (a["proof"] as Map<String, Any?>)["subject_sig"] != null
        }
        for (a in dcs) {
            val proof = a["proof"] as Map<String, Any?>
            val rp = proof["response_payload"] as? Map<String, Any?> ?: continue
            val subjectSig = proof["subject_sig"] as? String ?: continue
            val spub = if (subjectDeviceId != null) identities[subjectDeviceId] else null

            val subjOk = spub != null &&
                Crypto.verifyPayload(rp, subjectSig, spub) &&
                rp["subject_id"] == subjectDeviceId &&
                rp["attestor_id"] == a["claimer_id"]

            if (!subjOk) continue
            // presence confirmed. LOCATION confirmed only if subject-anchored OR >=2 independent attestors agree on the cell
            val ownCode = proof["own_plus_code8"] as? String ?: ""
            val attCode = rp["attestor_plus_code"] as? String ?: ""
            val subjectAnchored = attCode.isNotEmpty() && attCode == ownCode

            val sameCellAttestors = dcs.filter { x ->
                val xp = x["proof"] as? Map<String, Any?>
                val xCode = xp?.get("own_plus_code8") as? String ?: ""
                xCode == ownCode
            }.map { it["claimer_id"] as String }.toSet()
            if (subjectAnchored || sameCellAttestors.size >= 2) {
                tier = maxOf(tier, TIER["device_confirmed"]!!)
                locationVerified = true
            } else {
                tier = maxOf(tier, TIER["on_site"]!!)
                locationVerified = false
            }
        }

        // Self-confirmed: subject's own device signs self_confirm
        if (subjectDeviceId != null && valid.any { a ->
            a["att_type"] == "self_confirm" && a["claimer_id"] == subjectDeviceId
        }) {
            tier = maxOf(tier, TIER["self_confirmed"]!!)
            locationVerified = true
        }

        // Disputed: independent valid attestations assert contradictory primary facts
        val facts = valid.filter { a ->
            listOf("on_site", "corroborate", "resolve").contains(a["att_type"])
        }.map { it["fact"] as String }.toSet()
        val disputed = facts.contains("still_needs_help") && (facts.contains("found_safe") || facts.contains("false"))

        val tierName = REV_TIER[tier] ?: "reported"
        return FoldResult(tier, tierName, verified, disputed, locationVerified)
    }
}
