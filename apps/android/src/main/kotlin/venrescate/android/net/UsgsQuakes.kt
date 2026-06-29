package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Read-only client for the USGS Earthquake Hazards Program GeoJSON feed
 * (public domain). M2.5+ over the last month, filtered to the Venezuela region.
 * Epicenters are seismic context — rendered as their own map layer, separate
 * from signed records and community damage reports.
 *
 * Attribution: «USGS Earthquake Hazards Program».
 */
object UsgsQuakes {
    private const val ENDPOINT = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson"

    // Venezuela / southern Caribbean window.
    private const val MIN_LAT = 0.0
    private const val MAX_LAT = 14.0
    private const val MIN_LNG = -74.0
    private const val MAX_LNG = -59.0

    data class Quake(
        val id: String,
        val lat: Double,
        val lng: Double,
        val mag: Double,
        val place: String,
        val depthKm: Double,
        val timeMs: Long,
        val url: String,
        val source: String = "USGS",
    )

    suspend fun fetch(): List<Quake> = withContext(Dispatchers.IO) {
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
                val coords = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: return@mapNotNull null
                val lng = coords.optDouble(0, Double.NaN)
                val lat = coords.optDouble(1, Double.NaN)
                val depth = coords.optDouble(2, 0.0)
                if (lat.isNaN() || lng.isNaN()) return@mapNotNull null
                if (lat !in MIN_LAT..MAX_LAT || lng !in MIN_LNG..MAX_LNG) return@mapNotNull null
                val p = f.optJSONObject("properties") ?: return@mapNotNull null
                Quake(
                    id = f.optString("id"),
                    lat = lat,
                    lng = lng,
                    mag = p.optDouble("mag", 0.0),
                    place = if (p.isNull("place")) "" else p.optString("place"),
                    depthKm = depth,
                    timeMs = p.optLong("time", 0L),
                    url = if (p.isNull("url")) "" else p.optString("url"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }
}
