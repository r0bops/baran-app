package venrescate.android.ui

import androidx.compose.ui.graphics.Color
import venrescate.app.ReachLevel

/** es-VE labels + honest colours. Trust tier and reach are kept strictly separate. */
object Labels {
    val tierName = mapOf(
        "invalid" to "inválido",
        "reported" to "reportado",
        "corroborated" to "corroborado",
        "on_site" to "en sitio",
        "device_confirmed" to "confirmado por dispositivo",
        "self_confirmed" to "autoconfirmado",
    )
    val tierDesc = mapOf(
        "reported" to "Un solo reporte firmado. Aún sin verificar.",
        "corroborated" to "Dos o más personas independientes confirman lo mismo.",
        "on_site" to "Alguien estuvo en el lugar y aportó prueba de proximidad.",
        "device_confirmed" to "El dispositivo de la persona afectada confirmó su presencia.",
        "self_confirmed" to "La persona afectada confirmó directamente.",
    )
    val tierColor = mapOf(
        "invalid" to Color(0xFFEF4444),
        "reported" to Color(0xFFF59E0B),
        "corroborated" to Color(0xFFF97316),
        "on_site" to Color(0xFF3B82F6),
        "device_confirmed" to Color(0xFF22C55E),
        "self_confirmed" to Color(0xFF8B5CF6),
    )

    fun reachLabel(r: ReachLevel) = when (r) {
        ReachLevel.IN_MESH -> "en la red"
        ReachLevel.BRIDGED -> "llegó a internet"
        ReachLevel.ANCHORED -> "anclado"
    }
    fun reachDesc(r: ReachLevel) = when (r) {
        ReachLevel.IN_MESH -> "Solo visible en la malla local. No ha llegado a internet aún."
        ReachLevel.BRIDGED -> "Llegó a internet vía un puente. Visible para coordinadores."
        ReachLevel.ANCHORED -> "Anclado en registro inmutable."
    }
    fun reachColor(r: ReachLevel) = when (r) {
        ReachLevel.IN_MESH -> Color(0xFF6B7280)
        ReachLevel.BRIDGED -> Color(0xFF06B6D4)
        ReachLevel.ANCHORED -> Color(0xFF10B981)
    }

    val typeLabel = mapOf(
        "sos" to "SOS",
        "victim_found" to "Víctima encontrada",
        "need" to "Necesidad",
        "hazard" to "Peligro",
        "missing_person" to "Persona desaparecida",
        "status" to "Estado",
    )
    val typeEmoji = mapOf(
        "sos" to "🚨", "victim_found" to "✅", "need" to "📦",
        "hazard" to "⚠️", "missing_person" to "🔍", "status" to "📋",
    )
    fun typeColor(type: String) = when (type) {
        "sos" -> Color(0xFFEF4444)
        "victim_found" -> Color(0xFFF97316)
        "missing_person" -> Color(0xFFEAB308)
        "need" -> Color(0xFF22C55E)
        "hazard" -> Color(0xFFA855F7)
        else -> Color(0xFF6B7280)
    }

    fun prioLabel(p: Int) = when (p) {
        0 -> "P0 · Crítico (vida en riesgo)"
        1 -> "P1 · Urgente"
        2 -> "P2 · Importante"
        3 -> "P3 · Rutina"
        4 -> "P4 · Informativo"
        else -> "P$p"
    }
    fun prioColor(p: Int) = when (p) {
        0 -> Color(0xFFEF4444)
        1 -> Color(0xFFF97316)
        2 -> Color(0xFFEAB308)
        3 -> Color(0xFF3B82F6)
        else -> Color(0xFF6B7280)
    }

    val attLabel = mapOf(
        "corroborate" to "corrobora", "on_site" to "en sitio",
        "device_confirm" to "confirma dispositivo", "self_confirm" to "autoconfirma",
        "affirm" to "afirma", "resolve" to "resuelve", "dispute" to "disputa",
    )
    val factLabel = mapOf(
        "still_needs_help" to "necesita ayuda", "found_safe" to "a salvo",
        "present" to "presente", "false" to "falsa alarma",
    )
}
