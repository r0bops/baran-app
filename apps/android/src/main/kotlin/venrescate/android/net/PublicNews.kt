package venrescate.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/**
 * Read-only client for the public SOS Venezuela 2026 press feed.
 * Attribution required: «SOS Venezuela 2026».
 */
object PublicNews {
    private const val ENDPOINT = "https://sosvenezuela2026.com/api/news"

    data class Item(
        val id: String,
        val title: String,
        val url: String,
        val source: String,
        val summary: String,
        val publishedAt: String,
    )

    private fun stripHtml(s: String): String =
        s.replace(Regex("<[^>]*>"), " ")
            .replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"")
            .replace(Regex("https?://\\S+"), "")
            .replace(Regex("\\s+"), " ")
            .trim()

    suspend fun fetch(): List<Item> = withContext(Dispatchers.IO) {
        val conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 10000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (conn.responseCode !in 200..299) return@withContext emptyList()
            val arr = JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Item(
                    id = o.str("id"),
                    title = o.str("title"),
                    url = o.str("url"),
                    source = o.str("source"),
                    summary = stripHtml(o.str("summary")),
                    publishedAt = o.str("published_at"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }
}
