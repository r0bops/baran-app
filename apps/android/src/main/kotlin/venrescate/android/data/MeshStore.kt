package venrescate.android.data

import android.content.Context
import venrescate.android.mesh.MeshDelegate
import venrescate.android.mesh.MeshJson
import venrescate.android.mesh.SyncTransport
import venrescate.app.Reach
import venrescate.app.ReachLevel
import venrescate.app.SignalEngine
import venrescate.crypto.Crypto
import venrescate.geo.PlusCode
import venrescate.domain.AttestationRecord
import venrescate.domain.FoldResult
import venrescate.domain.ReportRecord
import venrescate.schema.CanonicalJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The on-device record store + reactive trust view, and the mesh delegate.
 *
 * Records authored here are signed and broadcast over [transport]; inbound payloads
 * are signature-verified (and the signer's key checked against its device_id) BEFORE
 * they enter the store, then re-gossiped. Trust is computed by [SignalEngine.fold],
 * never asserted. Swapping Nearby for Ditto means swapping the transport only.
 */
class MeshStore(private val context: Context) : MeshDelegate {

    val identity = LocalIdentity.loadOrCreate(context)
    private val engine = SignalEngine(identity, startSeq = LocalIdentity.loadSeq(context))

    private val reports = LinkedHashMap<String, ReportRecord>()
    private val attestations = LinkedHashMap<String, MutableList<AttestationRecord>>()
    private val identities = HashMap<String, ByteArray>()
    private val bridged = HashSet<String>()
    private val seen = HashSet<String>() // content_hashes already stored (gossip dedup)

    var transport: SyncTransport? = null

    private val _signals = MutableStateFlow<List<Signal>>(emptyList())
    val signals: StateFlow<List<Signal>> = _signals.asStateFlow()

    private val _peers = MutableStateFlow(0)
    val peers: StateFlow<Int> = _peers.asStateFlow()

    data class Signal(
        val report: ReportRecord,
        val fold: FoldResult,
        val reach: ReachLevel,
        val attestations: List<AttestationRecord>,
    )

    init {
        identities[identity.deviceId] = identity.publicKeyRaw
        seedDemoMesh()
        recompute()
    }

    fun deviceId(): String = identity.deviceId

    fun setPeerCount(n: Int) {
        _peers.value = n
    }

    fun signalFor(reportId: String): Signal? = _signals.value.find { it.report.id == reportId }

    fun createReport(type: String, prio: Int, payload: Map<String, Any?>, subjectId: String? = null): ReportRecord {
        val r = engine.createReport(type, prio, payload, subjectId)
        ingestReport(r)
        LocalIdentity.saveSeq(context, engine.currentSeq())
        recompute()
        envelope(r.toMap(), identity.deviceId)?.let { transport?.broadcast(it) }
        return r
    }

    fun attest(target: ReportRecord, attType: String, fact: String, proof: Map<String, Any?>? = null): AttestationRecord {
        val a = engine.createAttestation(target, attType, fact, proof)
        ingestAttestation(a)
        LocalIdentity.saveSeq(context, engine.currentSeq())
        recompute()
        envelope(a.toMap(), identity.deviceId)?.let { transport?.broadcast(it) }
        return a
    }

    fun onSiteProof(lat: Double, lng: Double, reportPlusCode: String) =
        engine.onSiteProof(lat, lng, reportPlusCode)

    /** Demo-only: simulate a gateway phone bridging this record to the cloud. */
    fun markBridged(reportId: String) {
        bridged.add(reportId)
        recompute()
    }

    // ---- MeshDelegate (transport callbacks) ----

    /** Verify an inbound envelope, merge it, and gossip onward if new. */
    @Synchronized
    override fun onPayload(payload: ByteArray) {
        val env = MeshJson.parse(String(payload, Charsets.UTF_8)) as? Map<*, *> ?: return
        val pub = env["pub"] as? String ?: return
        @Suppress("UNCHECKED_CAST")
        val rec = env["rec"] as? Map<String, Any?> ?: return
        val contentHash = rec["content_hash"] as? String ?: return
        if (seen.contains(contentHash)) return

        val pubRaw = try { Crypto.base64urlDecode(pub) } catch (e: Exception) { return }
        val signerId = (rec["author_id"] ?: rec["claimer_id"]) as? String ?: return
        if (Crypto.fingerprint(pubRaw) != signerId) return // device_id must match the key
        if (!Crypto.verify(rec, pubRaw)) return // forged signature

        identities[signerId] = pubRaw
        when (rec["kind"]) {
            "report" -> ingestReport(ReportRecord.fromMap(rec))
            "attestation" -> ingestAttestation(AttestationRecord.fromMap(rec))
            else -> return
        }
        recompute()
        transport?.broadcast(payload)
    }

    /** Every locally-held signed record as an API-ready map (reports + attestations). */
    @Synchronized
    fun allRecordMaps(): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        for (r in reports.values) out.add(r.toMap())
        for (list in attestations.values) for (a in list) out.add(a.toMap())
        return out
    }

    @Synchronized
    override fun snapshot(): List<ByteArray> {
        val out = ArrayList<ByteArray>()
        for (r in reports.values) envelope(r.toMap(), r.authorId)?.let { out.add(it) }
        for (list in attestations.values) for (a in list) envelope(a.toMap(), a.claimerId)?.let { out.add(it) }
        return out
    }

    private fun envelope(recMap: Map<String, Any?>, authorId: String): ByteArray? {
        val pub = identities[authorId] ?: return null
        return CanonicalJson.bytes(mapOf("pub" to Crypto.base64urlEncode(pub), "rec" to recMap))
    }

    // ---- ingestion (signature-verified before storage) ----

    private fun ingestReport(r: ReportRecord) {
        if (!Crypto.verify(r.toMap(), identities[r.authorId] ?: return)) return
        reports[r.id] = r
        seen.add(r.contentHash)
    }

    private fun ingestAttestation(a: AttestationRecord) {
        if (!Crypto.verify(a.toMap(), identities[a.claimerId] ?: return)) return
        attestations.getOrPut(a.targetReportId) { mutableListOf() }.add(a)
        seen.add(a.contentHash)
    }

    private fun recompute() {
        val list = reports.values
            .filter { it.kind == "report" }
            .map { rep ->
                val atts = attestations[rep.id] ?: emptyList()
                Signal(
                    report = rep,
                    fold = SignalEngine.fold(rep, atts, identities),
                    reach = Reach.compute(bridged.contains(rep.id), false),
                    attestations = atts,
                )
            }
            .sortedWith(compareBy({ it.report.prio }, { -it.report.createdWallMs }))
        _signals.value = list
    }

    // demo neighbourhood so the field UI is populated on first launch
    private fun seedDemoMesh() {
        val bob = Crypto.keyFromSeed(Crypto.IDS["bob"]!!)
        val carol = Crypto.keyFromSeed(Crypto.IDS["carol"]!!)
        val dora = Crypto.keyFromSeed(Crypto.IDS["dora"]!!)
        for (k in listOf(bob, carol, dora)) identities[k.deviceId] = k.publicKeyRaw

        var clock = 1_750_000_000_000L
        val bobEng = SignalEngine(bob, now = { clock })
        val carolEng = SignalEngine(carol, now = { clock })

        // Real Caracas / La Guaira locations, encoded so the codes round-trip
        // back onto the city (made-up codes used to land in the open Atlantic).
        val sosCode = PlusCode.encode(10.5061, -66.9146)   // Caracas centro
        val hazardCode = PlusCode.encode(10.5089, -66.9201) // Av. cercana
        val needCode = PlusCode.encode(10.6018, -66.9340)   // La Guaira / Maiquetía

        val sos = bobEng.createReport(
            "sos", 0,
            mapOf("severity" to "critical", "note" to "Dos personas atrapadas, edificio azul", "count" to 2, "plus_code" to sosCode),
        )
        ingestReport(sos)
        clock += 60_000
        ingestAttestation(carolEng.createAttestation(sos, "corroborate", "still_needs_help"))
        clock += 60_000
        ingestAttestation(
            carolEng.createAttestation(
                sos, "on_site", "still_needs_help",
                mapOf("type" to "pluscode", "match" to true, "plus_code8" to PlusCode.coarse(sosCode)),
            ),
        )

        clock += 120_000
        ingestReport(
            carolEng.createReport("hazard", 1, mapOf("note" to "Cables caídos en la avenida", "plus_code" to hazardCode)),
        )
        clock += 60_000
        ingestReport(
            bobEng.createReport("need", 2, mapOf("note" to "Se necesita agua y vendas", "count" to 12, "plus_code" to needCode)),
        )
    }
}
