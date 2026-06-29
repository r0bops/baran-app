package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/**
 * Read-only client for the public SOS Venezuela 2026 humanitarian dataset
 * (https://sosvenezuela2026.com). Open CORS, no auth. These are EXTERNAL,
 * unsigned community reports — rendered as a separate map overlay, never mixed
 * with VenRescate's own signed records. Coordinates are already truncated for
 * privacy upstream; we do not attempt to de-anonymise anything.
 *
 * Attribution required: «SOS Venezuela 2026».
 */
object PublicReports {
    private const val ENDPOINT = "https://sosvenezuela2026.com/api/reports"

    data class Report(
        val id: String,
        val lat: Double,
        val lng: Double,
        val category: String,
        val severity: String,
        val verification: String,
        val resourceStatus: String,
        val peopleTrapped: Int,
        val siteClass: String,
        val siteVs30: Int,
        val title: String,
        val municipio: String,
        val parroquia: String,
    ) {
        val isResource get() = category == "aid_point" || category == "shelter" || category == "water_point"
        val isTrapped get() = category == "trapped_people"
    }

    /** Fetch the latest reports. Returns empty on any failure (offline-friendly). */
    suspend fun fetch(): List<Report> = withContext(Dispatchers.IO) {
        val conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 10000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext emptyList()
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val arr = JSONArray(text)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val lat = o.optDouble("lat_pub", Double.NaN)
                val lng = o.optDouble("lng_pub", Double.NaN)
                if (lat.isNaN() || lng.isNaN()) return@mapNotNull null
                Report(
                    id = o.str("id"),
                    lat = lat,
                    lng = lng,
                    category = o.str("category"),
                    severity = o.str("severity"),
                    verification = o.str("verification"),
                    resourceStatus = o.str("resource_status"),
                    peopleTrapped = o.optInt("people_trapped_count", 0),
                    siteClass = o.str("site_class"),
                    siteVs30 = o.optInt("site_vs30", 0),
                    title = o.str("title"),
                    municipio = o.str("municipio"),
                    parroquia = o.str("parroquia"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }
}
