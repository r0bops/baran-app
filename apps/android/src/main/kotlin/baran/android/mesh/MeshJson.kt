package baran.android.mesh

import org.json.JSONArray
import org.json.JSONObject

/**
 * Parses inbound mesh payloads back into the `Map<String, Any?>` / `List` shape the
 * verification fold consumes. Numbers stay Int/Long (never Double) so re-canonicalising
 * a received record reproduces the exact signed bytes for signature verification.
 */
object MeshJson {
    fun parse(text: String): Any? =
        try { unwrap(JSONObject("{\"v\":$text}").get("v")) } catch (e: Exception) { null }

    private fun unwrap(value: Any?): Any? = when (value) {
        is JSONObject -> buildMap {
            val keys = value.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                put(k, unwrap(value.get(k)))
            }
        }
        is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
        JSONObject.NULL -> null
        else -> value
    }
}
