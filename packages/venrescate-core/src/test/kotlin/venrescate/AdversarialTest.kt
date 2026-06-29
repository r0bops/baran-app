package venrescate

import venrescate.app.SignalEngine
import venrescate.crypto.Crypto
import venrescate.trust.VerificationFold
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Cross-language parity for the adversarial guarantees (mirrors the TS/server suites):
 *  a forged, tampered, or Sybil attestation must never earn trust it didn't get honestly. */
class AdversarialTest {

    private fun id(name: String) = Crypto.keyFromSeed(Crypto.IDS[name]!!)

    @Test
    fun tamperingBreaksVerification() {
        val alice = id("alice")
        val sos = SignalEngine(alice, now = { 1_750_000_000_000L })
            .createReport("sos", 0, mapOf("note" to "atrapado", "plus_code" to "77GR2J4C+9P"))
        assertTrue(Crypto.verify(sos.toMap(), alice.publicKeyRaw))

        val tampered = sos.toMap().toMutableMap().apply { this["payload"] = mapOf("note" to "all clear") }
        assertFalse(Crypto.verify(tampered, alice.publicKeyRaw), "tampered body must not verify")

        val ids = mapOf(alice.deviceId to alice.publicKeyRaw)
        assertEquals("invalid", VerificationFold.fold(tampered, emptyList(), ids, null).tierName)
    }

    @Test
    fun wrongKeyRejected() {
        val alice = id("alice"); val bob = id("bob")
        val sos = SignalEngine(alice, now = { 1_750_000_000_000L }).createReport("sos", 0, mapOf("plus_code" to "77GR2J4C+9P"))
        assertFalse(Crypto.verify(sos.toMap(), bob.publicKeyRaw), "alice's record must not verify under bob's key")
    }

    @Test
    fun sybilCannotManufactureCorroboration() {
        val alice = id("alice"); val bob = id("bob"); val carol = id("carol")
        val ids = mapOf(alice.deviceId to alice.publicKeyRaw, bob.deviceId to bob.publicKeyRaw, carol.deviceId to carol.publicKeyRaw)
        val sos = SignalEngine(alice, now = { 1_750_000_000_000L }).createReport("sos", 0, mapOf("plus_code" to "77GR2J4C+9P"))

        val bobEng = SignalEngine(bob, now = { 1_750_000_000_000L })
        val sybil = (1..4).map { bobEng.createAttestation(sos, "corroborate", "still_needs_help") }
        assertEquals("reported", SignalEngine.fold(sos, sybil, ids).tierName, "one key, many attestations → still reported")

        val withCarol = sybil + SignalEngine(carol, now = { 1_750_000_000_000L }).createAttestation(sos, "corroborate", "still_needs_help")
        assertEquals("corroborated", SignalEngine.fold(sos, withCarol, ids).tierName, "two distinct keys → corroborated")
    }

    @Test
    fun impersonatedAttestationDropped() {
        val alice = id("alice"); val bob = id("bob"); val carol = id("carol"); val mallory = id("mallory")
        val ids = mapOf(alice.deviceId to alice.publicKeyRaw, bob.deviceId to bob.publicKeyRaw, carol.deviceId to carol.publicKeyRaw)
        val sos = SignalEngine(alice, now = { 1_750_000_000_000L }).createReport("sos", 0, mapOf("plus_code" to "77GR2J4C+9P"))

        // mallory signs an attestation but stamps carol's claimer_id
        val body = mapOf(
            "schema_version" to 1, "kind" to "attestation", "id" to "${carol.deviceId}:a:1",
            "claimer_id" to carol.deviceId, "claimer_seq" to 1, "target_report_id" to sos.id,
            "target_content_hash" to sos.contentHash, "att_type" to "corroborate", "fact" to "still_needs_help",
            "prio" to 0, "hlc" to "1750000000000.0.${carol.deviceId}",
        )
        val signed = Crypto.sign(body, mallory) // WRONG key
        val forged = body.toMutableMap().apply { put("content_hash", signed.contentHash); put("sig", signed.sig) }
        val bobEng = SignalEngine(bob, now = { 1_750_000_000_000L })
        val real = bobEng.createAttestation(sos, "corroborate", "still_needs_help").toMap()

        val res = VerificationFold.fold(sos.toMap(), listOf(forged, real), ids, null)
        assertEquals("reported", res.tierName, "impersonated attestation ignored — only bob counts")
    }
}
