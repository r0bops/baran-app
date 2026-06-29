package venrescate

import venrescate.app.Reach
import venrescate.app.ReachLevel
import venrescate.app.SignalEngine
import venrescate.crypto.Crypto
import venrescate.geo.PlusCode
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Verifies the field-app authoring core on the JVM: records it signs verify, and
 * the trust tiers it produces match the frozen fold semantics — the same logic the
 * Android Compose UI drives. (The Compose UI itself needs the Android SDK to run.)
 */
class SignalEngineTest {

    private fun id(name: String) = Crypto.keyFromSeed(Crypto.IDS[name]!!)

    @Test
    fun signsReportsThatVerify() {
        val alice = id("alice")
        val t = 1_750_000_000_000L
        val eng = SignalEngine(alice, now = { t })
        val sos = eng.createReport("sos", 0, mapOf("note" to "atrapado", "plus_code" to "77GR2J4C+9P"))

        assertTrue(Crypto.verify(sos.toMap(), alice.publicKeyRaw), "own signature verifies")
        assertEquals("${alice.deviceId}:1", sos.id)
        assertEquals(0, sos.prio)
    }

    @Test
    fun foldsThroughTheTiers() {
        val alice = id("alice"); val bob = id("bob"); val carol = id("carol")
        val ids = mapOf(
            alice.deviceId to alice.publicKeyRaw,
            bob.deviceId to bob.publicKeyRaw,
            carol.deviceId to carol.publicKeyRaw,
        )
        val t = 1_750_000_000_000L
        val sos = SignalEngine(alice, now = { t }).createReport(
            "sos", 0, mapOf("note" to "dos atrapados", "plus_code" to "77GR2J4C+9P"),
        )

        // no attestations -> reported
        assertEquals("reported", SignalEngine.fold(sos, emptyList(), ids).tierName)

        // bob + carol corroborate -> corroborated (2 distinct keys)
        val bobAtt = SignalEngine(bob, now = { t }).createAttestation(sos, "corroborate", "still_needs_help")
        val carolAtt = SignalEngine(carol, now = { t }).createAttestation(sos, "corroborate", "still_needs_help")
        assertEquals("corroborated", SignalEngine.fold(sos, listOf(bobAtt, carolAtt), ids).tierName)

        // carol on_site with a matching proximity proof -> on_site (tier 3 dominates)
        val onsite = SignalEngine(carol, now = { t }).createAttestation(
            sos, "on_site", "still_needs_help", mapOf("type" to "pluscode", "match" to true, "plus_code8" to "77GR2J4C"),
        )
        val f = SignalEngine.fold(sos, listOf(bobAtt, onsite), ids)
        assertEquals("on_site", f.tierName)
        assertTrue(f.tier == 3)

        // conflicting resolve (found_safe) -> disputed overlay
        val resolve = SignalEngine(bob, now = { t }).createAttestation(sos, "resolve", "found_safe")
        assertTrue(SignalEngine.fold(sos, listOf(onsite, resolve), ids).disputed, "contradictory facts surface dispute")
    }

    @Test
    fun reachIsItsOwnAxis() {
        assertEquals(ReachLevel.IN_MESH, Reach.compute(false, false))
        assertEquals(ReachLevel.BRIDGED, Reach.compute(true, false))
        assertEquals(ReachLevel.ANCHORED, Reach.compute(true, true))
    }

    @Test
    fun plusCodeRoundTrips() {
        val code = PlusCode.encode(10.5, -66.9)
        assertTrue(code.contains("+"))
        val ll = PlusCode.decode(code)!!
        assertTrue(abs(ll.lat - 10.5) < 0.01, "lat ${ll.lat}")
        assertTrue(abs(ll.lng - (-66.9)) < 0.01, "lng ${ll.lng}")
        assertEquals(8, PlusCode.coarse(code).length)
    }
}
