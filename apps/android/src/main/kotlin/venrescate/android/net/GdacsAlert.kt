package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Read-only client for GDACS (Global Disaster Alert and Coordination System).
 * Returns the most severe current earthquake alert for Venezuela — alert level
 * (Green/Orange/Red), magnitude, and a link to the official GDACS report —
 * for a top-of-map status banner. Public, no auth.
 *
 * Attribution: «GDACS (UN/EC)».
 */
object GdacsAlert {

    data class Alert(
        val level: String,        // Green | Orange | Red
        val title: String,        // e.g. "Magnitude 7.5M, Depth:10km"
        val name: String,
        val dateText: String,     // ISO date (first 10 chars)
        val reportUrl: String,
    )

    private fun rank(level: String) = when (level.lowercase()) {
        "red" -> 3; "orange" -> 2; "green" -> 1; else -> 0
    }

    suspend fun fetchVenezuela(): Alert? = withContext(Dispatchers.IO) {
        val today = java.time.LocalDate.now()
        val from = today.minusDays(45)
        val url = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH" +
            "?fromDate=$from&toDate=${today.plusDays(1)}&eventlist=EQ&country=Venezuela"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext null
            val root = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val feats = root.optJSONArray("features") ?: return@withContext null
            var best: Alert? = null
            for (i in 0 until feats.length()) {
                val p = feats.getJSONObject(i).optJSONObject("properties") ?: continue
                val level = p.optString("alertlevel")
                val sev = p.optJSONObject("severitydata")?.optString("severitytext") ?: ""
                val a = Alert(
                    level = level,
                    title = sev,
                    name = p.optString("name"),
                    dateText = p.optString("fromdate").take(10),
                    reportUrl = p.optJSONObject("url")?.optString("report") ?: "https://www.gdacs.org",
                )
                if (best == null || rank(a.level) > rank(best!!.level)) best = a
            }
            best
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
}
