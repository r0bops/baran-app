@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.data.MeshStore

private val BATTERY_MODES = listOf("Normal", "Conservar", "Frugal", "Lifeline")
private val LANGS = listOf("es-VE", "es-ES", "en")

/** "Ajustes" — language, battery duty-cycle, mesh visibility, gateway bridge. */
@Composable
fun SettingsScreen(store: MeshStore) {
    var lang by remember { mutableStateOf(LANGS[0]) }
    var battery by remember { mutableStateOf(BATTERY_MODES[0]) }
    var lowLiteracy by remember { mutableStateOf(false) }
    var bridge by remember { mutableStateOf(false) }
    val signals by store.signals.collectAsState()
    val peers by store.peers.collectAsState()

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Ajustes", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        SettingCard("Idioma") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LANGS.forEach { l -> FilterChip(selected = lang == l, onClick = { lang = l }, label = { Text(l) }) }
            }
        }

        SettingCard("Modo de batería") {
            Column {
                BATTERY_MODES.forEach { m ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = battery == m, onClick = { battery = m })
                        Text(m)
                        if (m == "Lifeline") Text(" · solo P0", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }

        SettingCard("Accesibilidad") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = lowLiteracy, onCheckedChange = { lowLiteracy = it })
                Spacer(Modifier.width(8.dp))
                Text("Modo de baja alfabetización (íconos + voz)")
            }
        }

        SettingCard("Puente a internet") {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = bridge,
                        onCheckedChange = {
                            bridge = it
                            if (it) signals.forEach { s -> store.markBridged(s.report.id) }
                        },
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Ser puente (cuando tenga señal)")
                }
                Text(
                    if (bridge) "🌐 Sirviendo de puente · alcance de las señales actualizado a «llegó a internet»"
                    else "Cuando captes internet, reenvía la malla al coordinador y trae respuestas.",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
                )
            }
        }

        SettingCard("Estado de la malla") {
            Column {
                Text("Transporte: Nearby Connections (BLE + Wi-Fi)", fontSize = 12.sp)
                Text(
                    if (peers == 0) "Sin pares cercanos · buscando…" else "Pares cercanos: $peers",
                    fontSize = 12.sp,
                    color = if (peers == 0) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.secondary,
                )
            }
        }
    }
}

@Composable
private fun SettingCard(title: String, content: @Composable () -> Unit) {
    Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}
