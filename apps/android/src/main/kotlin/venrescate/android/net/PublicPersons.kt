package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** optString returns the literal "null" for JSON null on Android; this maps it to "". */
internal fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)

/**
 * Read-only client for the public SOS Venezuela 2026 persons directory
 * (reported missing / found). Cédulas are masked upstream and minors protected;
 * we surface the data as-is and never attempt to de-anonymise.
 *
 * Attribution required: «SOS Venezuela 2026».
 */
object PublicPersons {
    private const val BASE = "https://sosvenezuela2026.com/api"

    data class Stats(
        val missing: Int,
        val found: Int,
        val total: Int,
        val missingMinors: Int,
        val foundMinors: Int,
    )

    data class Person(
        val id: String,
        val status: String,        // seeking_info | found_alive
        val displayName: String,
        val cedulaMasked: String,
        val municipio: String,
        val parroquia: String,
        val hospitalName: String,
    )

    suspend fun stats(): Stats? = withContext(Dispatchers.IO) {
        runCatching {
            val o = JSONObject(get("$BASE/persons/stats"))
            Stats(
                missing = o.optInt("missing"),
                found = o.optInt("found"),
                total = o.optInt("total"),
                missingMinors = o.optInt("missing_minors"),
                foundMinors = o.optInt("found_minors"),
            )
        }.getOrNull()
    }

    /** Search the directory. [estado] is "seeking_info" | "found_alive" | null (both). */
    suspend fun list(q: String = "", estado: String? = null, limit: Int = 50): List<Person> =
        withContext(Dispatchers.IO) {
            runCatching {
                val params = buildList {
                    if (q.length >= 2) add("q=" + URLEncoder.encode(q, "UTF-8"))
                    if (estado != null) add("estado=$estado")
                    add("limit=$limit")
                }.joinToString("&")
                val arr = JSONArray(get("$BASE/persons/list?$params"))
                (0 until arr.length()).map { i ->
                    val o = arr.getJSONObject(i)
                    Person(
                        id = o.str("id"),
                        status = o.str("status"),
                        displayName = o.str("display_name"),
                        cedulaMasked = o.str("cedula_masked"),
                        municipio = o.str("municipio"),
                        parroquia = o.str("parroquia"),
                        hospitalName = o.str("hospital_name"),
                    )
                }
            }.getOrDefault(emptyList())
        }

    data class LocalityCount(val name: String, val lat: Double, val lng: Double, val missing: Int, val found: Int) {
        val total get() = missing + found
    }

    // Bundled centroids for the localities that appear in the directory's parroquia
    // breadcrumbs — ordered specific → generic so "La Guaira · Caraballeda" maps to
    // Caraballeda, not the broader La Guaira. Neighborhood-level only (no individuals).
    private val GAZETTEER: List<Triple<String, Double, Double>> = listOf(
        Triple("caraballeda", 10.611, -66.851),
        Triple("tanaguarena", 10.620, -66.812),
        Triple("naiguatá", 10.620, -66.742),
        Triple("naiguata", 10.620, -66.742),
        Triple("catia la mar", 10.601, -67.031),
        Triple("maiquetía", 10.601, -66.984),
        Triple("maiquetia", 10.601, -66.984),
        Triple("macuto", 10.602, -66.884),
        Triple("playa grande", 10.606, -66.962),
        Triple("la guaira", 10.601, -66.931),
        Triple("puerto cabello", 10.473, -68.012),
        Triple("maracay", 10.247, -67.596),
        Triple("san felipe", 10.339, -68.740),
        Triple("libertador", 10.506, -66.914),
        Triple("caracas", 10.498, -66.914),
        Triple("distrito capital", 10.498, -66.914),
    )

    private fun locate(parroquia: String): Triple<String, Double, Double>? {
        val s = parroquia.lowercase()
        return GAZETTEER.firstOrNull { s.contains(it.first) }
    }

    /** Aggregate reported persons onto neighborhood centroids (privacy-safe).
     *  Samples up to [pages]×100 of the most recent records. */
    suspend fun localityCounts(pages: Int = 5): List<LocalityCount> = withContext(Dispatchers.IO) {
        val missing = HashMap<String, IntArray>() // name -> [missing, found], keyed by display name
        val coords = HashMap<String, Pair<Double, Double>>()
        for (page in 0 until pages) {
            val batch = listPage(page * 100)
            if (batch.isEmpty()) break
            for (p in batch) {
                val g = locate(p.parroquia.ifBlank { p.municipio }) ?: continue
                val display = g.first.replaceFirstChar { it.uppercase() }
                val arr = missing.getOrPut(display) { IntArray(2) }
                if (p.status == "found_alive") arr[1]++ else arr[0]++
                coords[display] = g.second to g.third
            }
        }
        missing.map { (name, arr) ->
            val c = coords.getValue(name)
            LocalityCount(name, c.first, c.second, arr[0], arr[1])
        }.sortedByDescending { it.total }
    }

    /** Persons whose parroquia maps to [areaDisplay] (the bubble's neighborhood name). */
    suspend fun byLocality(areaDisplay: String, pages: Int = 6): List<Person> = withContext(Dispatchers.IO) {
        val out = ArrayList<Person>()
        for (page in 0 until pages) {
            val batch = listPage(page * 100)
            if (batch.isEmpty()) break
            for (p in batch) {
                val g = locate(p.parroquia.ifBlank { p.municipio }) ?: continue
                if (g.first.replaceFirstChar { it.uppercase() } == areaDisplay) out.add(p)
            }
        }
        out
    }

    private suspend fun listPage(offset: Int): List<Person> = withContext(Dispatchers.IO) {
        runCatching {
            val arr = JSONArray(get("$BASE/persons/list?limit=100&offset=$offset"))
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Person(o.str("id"), o.str("status"), o.str("display_name"), o.str("cedula_masked"), o.str("municipio"), o.str("parroquia"), o.str("hospital_name"))
            }
        }.getOrDefault(emptyList())
    }

    private fun get(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
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
