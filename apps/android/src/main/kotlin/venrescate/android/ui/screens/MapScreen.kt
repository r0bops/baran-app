package venrescate.android.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.data.MeshStore
import venrescate.android.ui.Labels
import venrescate.geo.PlusCode
import kotlin.math.hypot

/**
 * Offline schematic map — no basemap tiles, no network. Pins are positioned by
 * decoding each signal's Plus Code and auto-fitting the bounds. Production swaps
 * this for MapLibre Native + bundled Caracas/La Guaira PMTiles (same pin model).
 */
@Composable
fun MapScreen(signals: List<MeshStore.Signal>, onOpen: (String) -> Unit) {
    data class Pin(val id: String, val lat: Double, val lng: Double, val type: String, val tier: String, val disputed: Boolean, val prio: Int)

    val pins = remember(signals) {
        signals.mapNotNull { s ->
            val code = (s.report.payload["plus_code"] ?: s.report.payload["plus_code8"])?.toString()
            PlusCode.decode(code)?.let { Pin(s.report.id, it.lat, it.lng, s.report.type, s.fold.tierName, s.fold.disputed, s.report.prio) }
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Mapa", fontSize = 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        Text(
            "Esquemático · posiciones desde Plus Codes · sin conexión",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        if (pins.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text("Sin coordenadas para mostrar", color = MaterialTheme.colorScheme.outline)
            }
            return@Column
        }

        val minLat = pins.minOf { it.lat }; val maxLat = pins.maxOf { it.lat }
        val minLng = pins.minOf { it.lng }; val maxLng = pins.maxOf { it.lng }
        val spanLat = (maxLat - minLat).coerceAtLeast(1e-4)
        val spanLng = (maxLng - minLng).coerceAtLeast(1e-4)
        val pad = 60f

        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .pointerInput(pins) {
                    detectTapGestures { tap ->
                        val w = size.width.toFloat() - 2 * pad
                        val h = size.height.toFloat() - 2 * pad
                        var best: String? = null
                        var bestD = Double.MAX_VALUE
                        for (p in pins) {
                            val x = pad + ((p.lng - minLng) / spanLng * w).toFloat()
                            val y = pad + ((1 - (p.lat - minLat) / spanLat) * h).toFloat()
                            val d = hypot((tap.x - x).toDouble(), (tap.y - y).toDouble())
                            if (d < bestD) { bestD = d; best = p.id }
                        }
                        if (best != null && bestD < 48.0) onOpen(best!!)
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val w = size.width - 2 * pad
                val h = size.height - 2 * pad
                val grid = Color(0xFF16213E)
                for (i in 0..8) {
                    val x = pad + i * w / 8
                    drawLine(grid, Offset(x, pad), Offset(x, pad + h), 1f)
                }
                for (i in 0..5) {
                    val y = pad + i * h / 5
                    drawLine(grid, Offset(pad, y), Offset(pad + w, y), 1f)
                }
                for (p in pins) {
                    val x = pad + ((p.lng - minLng) / spanLng * w).toFloat()
                    val y = pad + ((1 - (p.lat - minLat) / spanLat) * h).toFloat()
                    val color = Labels.typeColor(p.type)
                    val ring = Labels.tierColor[p.tier] ?: Color(0xFF64748B)
                    val rad = if (p.type == "sos") 22f else 16f
                    drawCircle(ring, rad + 6f, Offset(x, y), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 5f))
                    drawCircle(color, rad, Offset(x, y))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("Anillo = nivel de confianza · toca un pin para ver el detalle", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
    }
}
