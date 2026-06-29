package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Centralized missing-persons source: the community PFIF API (api-vzla-pfif),
 * which normalizes + dedups VenezuelaTeBusca / DesaparecidosTerremotoVenezuela
 * and exposes REST + PFIF 1.4. Run locally on :4000 and reached over an
 * `adb reverse tcp:4000` tunnel. Records carry only free-text `lastSeenLocation`
 * (no coordinates) — map placement is aggregated to neighborhood centroids.
 *
 * Attribution: «api-vzla-pfif · VenezuelaTeBusca».
 */
object PfifPersons {
    private const val BASE = "http://localhost:4000/api/v1"

    data class Stats(val total: Int, val missing: Int, val found: Int, val deceased: Int)

    data class Person(
        val id: String,
        val fullName: String,
        val age: Int?,
        val gender: String,
        val lastSeenLocation: String,
        val status: String,    // missing | found | deceased
        val hospital: String,
        val source: String,
    )

    data class LocalityCount(val name: String, val lat: Double, val lng: Double, val missing: Int, val found: Int) {
        val total get() = missing + found
    }

    suspend fun stats(): Stats? = withContext(Dispatchers.IO) {
        runCatching {
            val d = JSONObject(get("$BASE/stats")).getJSONObject("data")
            Stats(d.optInt("total"), d.optInt("missing"), d.optInt("found"), d.optInt("deceased"))
        }.getOrNull()
    }

    /** [status]: "missing" | "found" | null. [query] matches name and location. */
    suspend fun list(query: String = "", status: String? = null, limit: Int = 100): List<Person> =
        withContext(Dispatchers.IO) {
            runCatching {
                val params = buildList {
                    if (query.isNotBlank()) add("query=" + URLEncoder.encode(query, "UTF-8"))
                    if (status != null) add("status=$status")
                    add("limit=$limit")
                }.joinToString("&")
                val arr = JSONObject(get("$BASE/persons?$params")).getJSONArray("data")
                (0 until arr.length()).map { i -> parse(arr.getJSONObject(i)) }
            }.getOrDefault(emptyList())
        }

    /** Aggregate located records onto neighborhood centroids (privacy-safe). */
    suspend fun localityCounts(): List<LocalityCount> = withContext(Dispatchers.IO) {
        val people = list(limit = 200)
        val counts = HashMap<String, IntArray>()
        val coords = HashMap<String, Pair<Double, Double>>()
        for (p in people) {
            val g = locate(p.lastSeenLocation) ?: continue
            val display = g.first.replaceFirstChar { it.uppercase() }
            val arr = counts.getOrPut(display) { IntArray(2) }
            if (p.status == "found") arr[1]++ else arr[0]++
            coords[display] = g.second to g.third
        }
        counts.map { (name, arr) ->
            val c = coords.getValue(name)
            LocalityCount(name, c.first, c.second, arr[0], arr[1])
        }.sortedByDescending { it.total }
    }

    /** Records whose location maps to [areaDisplay] (the bubble's neighborhood). */
    suspend fun byLocality(areaDisplay: String): List<Person> = withContext(Dispatchers.IO) {
        list(limit = 200).filter { locate(it.lastSeenLocation)?.first?.replaceFirstChar { c -> c.uppercase() } == areaDisplay }
    }

    private fun parse(o: JSONObject) = Person(
        id = o.optString("id"),
        fullName = if (o.isNull("fullName")) "" else o.optString("fullName"),
        age = if (o.isNull("age")) null else o.optInt("age"),
        gender = if (o.isNull("gender")) "" else o.optString("gender"),
        lastSeenLocation = if (o.isNull("lastSeenLocation")) "" else o.optString("lastSeenLocation"),
        status = o.optString("status", "missing"),
        hospital = if (o.isNull("hospital")) "" else o.optString("hospital"),
        source = o.optString("source"),
    )

    // Specific → generic so "La Guaira · Caraballeda" maps to Caraballeda. Neighborhood-level only.
    private val GAZETTEER: List<Triple<String, Double, Double>> = listOf(
        Triple("caraballeda", 10.611, -66.851),
        Triple("tanaguaren", 10.620, -66.812),   // tanaguarena(s)
        Triple("naiguat", 10.620, -66.742),
        Triple("catia la mar", 10.601, -67.031),
        Triple("maiquet", 10.601, -66.984),
        Triple("macuto", 10.602, -66.884),
        Triple("playa grande", 10.606, -66.962),
        Triple("caribe", 10.604, -66.870),
        Triple("chacao", 10.497, -66.853),
        Triple("alto prado", 10.456, -66.853),
        Triple("la guaira", 10.601, -66.931),
        Triple("guaira", 10.601, -66.931),
        Triple("vargas", 10.601, -66.931),
        Triple("caracas", 10.498, -66.914),
        Triple("puerto cabello", 10.473, -68.012),
    )

    private fun locate(loc: String): Triple<String, Double, Double>? {
        val s = loc.lowercase()
        return GAZETTEER.firstOrNull { s.contains(it.first) }
    }

    private fun get(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5000
            readTimeout = 10000
            setRequestProperty("Accept", "application/json")
        }
        return try {
            conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
