package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Read-only client for the EMSC / European-Mediterranean Seismological Centre
 * FDSN feed (seismicportal.eu). Public, no auth. EMSC's regional network is
 * denser than USGS for Venezuela, so it surfaces more small aftershocks.
 * Returns the same [UsgsQuakes.Quake] shape so both feeds merge on one map layer.
 *
 * Attribution: «EMSC-CSEM».
 */
object EmscQuakes {
    private const val ENDPOINT =
        "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&orderby=time&limit=300" +
            "&minlat=0&maxlat=14&minlon=-74&maxlon=-59&minmag=2.5"

    suspend fun fetch(): List<UsgsQuakes.Quake> = withContext(Dispatchers.IO) {
        val conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext emptyList()
            val root = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val feats = root.optJSONArray("features") ?: return@withContext emptyList()
            (0 until feats.length()).mapNotNull { i ->
                val f = feats.getJSONObject(i)
                val c = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: return@mapNotNull null
                val lng = c.optDouble(0, Double.NaN)
                val lat = c.optDouble(1, Double.NaN)
                if (lat.isNaN() || lng.isNaN()) return@mapNotNull null
                val p = f.optJSONObject("properties") ?: return@mapNotNull null
                val unid = p.optString("unid", f.optString("id"))
                UsgsQuakes.Quake(
                    id = unid,
                    lat = lat,
                    lng = lng,
                    mag = p.optDouble("mag", 0.0),
                    place = if (p.isNull("flynn_region")) "" else p.optString("flynn_region"),
                    depthKm = p.optDouble("depth", c.optDouble(2, 0.0)),
                    timeMs = parseIso(p.optString("time")),
                    url = "https://www.seismicportal.eu/eventdetails.html?unid=$unid",
                    source = "EMSC",
                )
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }

    private fun parseIso(t: String): Long = runCatching {
        java.time.Instant.parse(if (t.endsWith("Z") || t.contains("+")) t else "${t}Z").toEpochMilli()
    }.getOrDefault(0L)
}
