@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import venrescate.android.data.LocalIdentity
import venrescate.android.data.MapFilters
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
    MapFilters.ensureLoaded(context)
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

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
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

        ExpandableSettingCard("Fuentes de datos", subtitle = "Mostrar / ocultar") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Activa o desactiva cada fuente. Afecta el mapa y los listados.",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SourceGroup(context, "VenRescate · malla firmada", listOf(MapFilters.SIGNED to "Señales firmadas"))
                SourceGroup(
                    context, "SOS Venezuela 2026",
                    listOf(MapFilters.AID to "Puntos de ayuda", MapFilters.DAMAGE to "Daños", MapFilters.TRAPPED to "Personas atrapadas", MapFilters.NEWS to "Noticias"),
                )
                SourceGroup(context, "USGS", listOf(MapFilters.USGS to "Sismos (epicentros)"))
                SourceGroup(context, "EMSC", listOf(MapFilters.EMSC to "Sismos (red regional)"))
                SourceGroup(context, "GDACS", listOf(MapFilters.GDACS to "Alerta oficial"))
                SourceGroup(context, "api-vzla-pfif", listOf(MapFilters.PERSONS to "Personas (agregado)"))
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

/** A SettingCard whose body collapses behind a tappable header (collapsed by default). */
@Composable
private fun ExpandableSettingCard(title: String, subtitle: String, content: @Composable () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = !expanded }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(
                    if (expanded) "Ocultar" else subtitle,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.primary,
                )
                Icon(
                    if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = if (expanded) "Ocultar" else "Mostrar",
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            AnimatedVisibility(visible = expanded) {
                Column(Modifier.padding(top = 8.dp)) { content() }
            }
        }
    }
}

/** One API/provider group with a switch per source it exposes. */
@Composable
private fun SourceGroup(context: android.content.Context, name: String, sources: List<Pair<String, String>>) {
    Column {
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
        sources.forEach { (key, label) ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Switch(checked = MapFilters.isOn(key), onCheckedChange = { MapFilters.set(context, key, it) })
                Spacer(Modifier.width(10.dp))
                Text(label, fontSize = 13.sp)
            }
        }
    }
}
