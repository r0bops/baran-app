package baran.schema

object CanonicalJson {
    fun encode(value: Any?): String = when (value) {
        null -> "null"
        is Map<*, *> -> {
            val entries = value.entries.sortedBy { (k, _) -> k.toString() }
            "{" + entries.joinToString(",") { (k, v) ->
                "\"${escapeString(k.toString())}\":${encode(v)}"
            } + "}"
        }
        is List<*> -> "[" + value.joinToString(",") { encode(it) } + "]"
        is String -> "\"${escapeString(value)}\""
        is Boolean -> if (value) "true" else "false"
        is Int -> value.toString()
        is Long -> value.toString()
        is Double -> {
            require(value == value.toLong().toDouble() && !value.isInfinite() && !value.isNaN()) {
                "non-integer number in record: $value"
            }
            value.toLong().toString()
        }
        is Number -> {
            val l = value.toLong()
            require(l.toDouble() == value.toDouble()) { "non-integer number in record: $value" }
            l.toString()
        }
        else -> throw IllegalArgumentException("unsupported type: ${value.javaClass.name}")
    }

    fun bytes(value: Any?): ByteArray = encode(value).toByteArray(Charsets.UTF_8)

    private fun escapeString(s: String): String {
        val sb = StringBuilder()
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c.code < 0x20) {
                    sb.append(String.format("\\u%04x", c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        return sb.toString()
    }
}
