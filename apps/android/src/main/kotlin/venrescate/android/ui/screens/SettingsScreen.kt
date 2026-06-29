@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import venrescate.android.data.LocalIdentity
import venrescate.android.data.MeshStore
import venrescate.android.mesh.CoordinatorBridge

private val BATTERY_MODES = listOf("Normal", "Conservar", "Frugal", "Lifeline")
private val LANGS = listOf("es-VE", "es-ES", "en")

/** "Ajustes" — language, battery duty-cycle, mesh visibility, gateway bridge. */
@Composable
fun SettingsScreen(store: MeshStore) {
    var lang by remember { mutableStateOf(LANGS[0]) }
    var battery by remember { mutableStateOf(BATTERY_MODES[0]) }
    var lowLiteracy by remember { mutableStateOf(false) }
    val signals by store.signals.collectAsState()
    val peers by store.peers.collectAsState()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bridge by remember { mutableStateOf(false) }
    var bridgeBase by remember { mutableStateOf(LocalIdentity.loadBridgeBase(context)) }
    var bridgeBusy by remember { mutableStateOf(false) }
    var bridgeStatus by remember { mutableStateOf<String?>(null) }

    fun syncToCoordinator() {
        bridgeBusy = true
        bridgeStatus = "Conectando al coordinador…"
        LocalIdentity.saveBridgeBase(context, bridgeBase)
        scope.launch {
            val res = CoordinatorBridge.pushAll(bridgeBase, store.allRecordMaps())
            res.bridgedReportIds.forEach { store.markBridged(it) }
            bridgeBusy = false
            bridgeStatus = when {
                res.pushed > 0 && res.failed == 0 -> "✅ ${res.pushed} registros enviados al coordinador"
                res.pushed > 0 -> "Enviados ${res.pushed}, fallaron ${res.failed} · ${res.error ?: ""}"
                else -> "No se pudo conectar · ${res.error ?: "sin respuesta"}"
            }
        }
    }

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
                        enabled = !bridgeBusy,
                        onCheckedChange = {
                            bridge = it
                            if (it) syncToCoordinator() else bridgeStatus = null
                        },
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Ser puente (cuando tenga señal)")
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = bridgeBase,
                    onValueChange = { bridgeBase = it },
                    label = { Text("Coordinador (URL)") },
                    singleLine = true,
                    enabled = !bridgeBusy,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { syncToCoordinator() }, enabled = !bridgeBusy) {
                        Text(if (bridgeBusy) "Sincronizando…" else "Sincronizar ahora")
                    }
                    Spacer(Modifier.width(12.dp))
                    Text("${store.allRecordMaps().size} registros locales", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
                }
                bridgeStatus?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "Reenvía la malla local al coordinador. Las firmas se re-verifican en el servidor.",
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
