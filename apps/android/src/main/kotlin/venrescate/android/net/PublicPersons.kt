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
