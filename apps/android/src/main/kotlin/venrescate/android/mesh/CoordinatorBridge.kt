package venrescate.android.mesh

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import venrescate.schema.CanonicalJson
import java.net.HttpURLConnection
import java.net.URL

/**
 * The opportunistic internet gateway: when this phone has a signal, it forwards
 * the locally-held signed records to the coordinator's cloud spine over HTTP.
 *
 * Records are pushed verbatim — the same canonical JSON they were signed over — so
 * the server re-verifies each Ed25519 signature. Unknown keys are accepted by the
 * backend tagged `origin: online` (lower trust), never silently elevated.
 */
object CoordinatorBridge {

    data class PushResult(
        val pushed: Int,
        val failed: Int,
        val bridgedReportIds: List<String>,
        val error: String?,
    )

    /** POST every record to {base}/v1/records. Returns counts + the report ids that landed. */
    suspend fun pushAll(base: String, records: List<Map<String, Any?>>): PushResult =
        withContext(Dispatchers.IO) {
            val endpoint = base.trim().trimEnd('/') + "/v1/records"
            var pushed = 0
            var failed = 0
            val bridged = ArrayList<String>()
            var firstError: String? = null

            for (rec in records) {
                try {
                    val code = postOne(endpoint, CanonicalJson.bytes(rec))
                    if (code in 200..299) {
                        pushed++
                        if (rec["kind"] == "report") (rec["id"] as? String)?.let { bridged.add(it) }
                    } else {
                        failed++
                        if (firstError == null) firstError = "HTTP $code"
                    }
                } catch (e: Exception) {
                    failed++
                    if (firstError == null) firstError = e.message ?: e.javaClass.simpleName
                }
            }
            PushResult(pushed, failed, bridged, firstError)
        }

    private fun postOne(endpoint: String, body: ByteArray): Int {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 4000
            readTimeout = 6000
            setRequestProperty("Content-Type", "application/json")
        }
        return try {
            conn.outputStream.use { it.write(body) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }
}
