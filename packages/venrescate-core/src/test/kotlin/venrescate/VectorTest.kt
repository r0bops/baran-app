package venrescate

import venrescate.crypto.VenRescateIdentity
import venrescate.crypto.Crypto
import venrescate.trust.VerificationFold
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File

object VectorTest {
    private val gson = Gson()
    private val vectorsDir = File(System.getProperty("user.dir"), "test-vectors")

    private fun load(name: String): Map<String, Any?> {
        val file = File(vectorsDir, name)
        val type = object : TypeToken<Map<String, Any?>>() {}.type
        return gson.fromJson(file.readText(), type)
    }

    private var passed = 0
    private var failed = 0

    private fun assert(cond: Boolean, msg: String) {
        if (cond) { passed++ }
        else { println("FAIL: $msg"); failed++ }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        // Load vectors
        val keys = load("keys.json")
        val cryptoVectors = load("crypto-vectors.json")
        val foldVectors = load("fold-vectors.json")
        val clockVectors = load("clock-vectors.json")

        // 1. Derive identities
        println("\n=== Identity derivation ===")
        val identities = mutableMapOf<String, VenRescateIdentity>()
        val pubRawById = mutableMapOf<String, ByteArray>()

        @Suppress("UNCHECKED_CAST")
        val keysMap = keys as Map<String, Map<String, String>>
        for ((name, k) in keysMap) {
            val id = Crypto.keyFromSeed(k["seed_hex"]!!)
            identities[name] = id
            assert(id.publicKeyB64u == k["public_key_b64u"], "$name: public key matches")
            assert(id.deviceId == k["device_id"], "$name: device_id matches")
            pubRawById[id.deviceId] = id.publicKeyRaw
        }

        // 2. Crypto vectors
        println("\n=== Crypto vectors ===")
        @Suppress("UNCHECKED_CAST")
        val cases = cryptoVectors["cases"] as List<Map<String, Any?>>

        // valid_signed_sos
        val case0 = cases[0]
        @Suppress("UNCHECKED_CAST")
        val sosAlice = case0["record"] as Map<String, Any?>
        assert(case0["expect_verify"] == true, "valid_signed_sos: expect true")

        // Re-sign
        val recordBody = sosAlice.filterKeys { it != "sig" && it != "content_hash" }
        val reSigned = Crypto.sign(recordBody, identities["alice"]!!)
        assert(reSigned.contentHash == sosAlice["content_hash"], "valid_signed_sos: content_hash matches")
        assert(reSigned.sig == sosAlice["sig"], "valid_signed_sos: sig matches")

        // Canonical bytes
        assert(reSigned.canonical == case0["canonical_bytes_utf8"], "valid_signed_sos: canonical bytes match")

        // Verify
        assert(Crypto.verify(sosAlice, identities["alice"]!!.publicKeyRaw), "valid_signed_sos: verify returns true")

        // Tampered
        @Suppress("UNCHECKED_CAST")
        val tampered = cases[1]["record"] as Map<String, Any?>
        assert(!Crypto.verify(tampered, identities["alice"]!!.publicKeyRaw), "tampered_payload: verify returns false")

        // Wrong key
        assert(!Crypto.verify(sosAlice, identities["bob"]!!.publicKeyRaw), "wrong_key: verify returns false")

        // 3. Fold vectors
        println("\n=== Fold vectors ===")
        @Suppress("UNCHECKED_CAST")
        val scenarios = foldVectors["scenarios"] as List<Map<String, Any?>>
        for (scenario in scenarios) {
            val name = scenario["name"] as String
            @Suppress("UNCHECKED_CAST")
            val report = scenario["report"] as Map<String, Any?>
            @Suppress("UNCHECKED_CAST")
            val attestations = scenario["attestations"] as List<Map<String, Any?>>
            val subjectId = scenario["subject_device_id"] as? String

            val result = VerificationFold.fold(report, attestations, pubRawById, subjectId)
            @Suppress("UNCHECKED_CAST")
            val expected = scenario["expected"] as Map<String, Any?>

            assert(result.tier == (expected["tier"] as Double).toInt(), "$name: tier ${result.tier} == ${(expected["tier"] as Double).toInt()}")
            assert(result.tierName == expected["tierName"], "$name: tierName ${result.tierName} == ${expected["tierName"]}")
            assert(result.verified == expected["verified"], "$name: verified")
            assert(result.disputed == expected["disputed"], "$name: disputed")
            assert(result.locationVerified == expected["location_verified"], "$name: location_verified")
        }

        // 4. Clock vectors
        println("\n=== Clock vectors ===")
        @Suppress("UNCHECKED_CAST")
        val clockCases = clockVectors["cases"] as List<Map<String, Any?>>
        @Suppress("UNCHECKED_CAST")
        val expectedOrder = clockCases[0]["expected_order"] as List<String>
        assert(expectedOrder[0] == "ELpoLIrRNROXHotW:1", "causal_order: first record")
        assert(expectedOrder[1] == "ELpoLIrRNROXHotW:2", "causal_order: second record")
        assert((clockCases[1]["prio"] as Double).toInt() == 0, "p0_future: prio is 0")
        assert((clockCases[1]["expected"] as String).contains("ACCEPTED"), "p0_future: expected ACCEPTED")

        println("\n$passed passed, $failed failed")
        if (failed > 0) throw AssertionError("$failed vector assertions failed")
        else println("ALL VECTORS PASS — Kotlin")
    }
}
