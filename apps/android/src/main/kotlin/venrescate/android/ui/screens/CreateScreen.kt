@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.data.MeshStore
import venrescate.android.ui.Labels
import venrescate.geo.PlusCode

private data class SignalKind(val label: String, val type: String, val prio: Int, val severity: String? = null)

private val KINDS = listOf(
    SignalKind("SOS · Atrapado", "sos", 0, "critical"),
    SignalKind("SOS · Herido", "sos", 0, "injured"),
    SignalKind("Persona desaparecida", "missing_person", 1),
    SignalKind("Necesidad", "need", 2),
    SignalKind("Peligro", "hazard", 1),
    SignalKind("Estado", "status", 3),
)

/**
 * On "Enviar" the record is SIGNED LOCALLY and inserted into the mesh.
 * No name/account required (pseudonymous by default).
 */
@Composable
fun CreateScreen(store: MeshStore, onDone: (String?) -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    var kind by remember { mutableStateOf<SignalKind?>(null) }
    var plusCode by remember { mutableStateOf("77GR2J4C+9P") }
    var coarse by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var count by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (step == 0) onDone(null) else step-- }) { Text(if (step == 0) "Cancelar" else "← Atrás") }
            Spacer(Modifier.weight(1f))
            Text("Paso ${step + 1} de 3", color = MaterialTheme.colorScheme.outline, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))

        when (step) {
            0 -> {
                Text("¿Qué quieres reportar?", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                KINDS.forEach { k ->
                    Card(
                        onClick = { kind = k; step = 1 },
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    ) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(Labels.typeEmoji[k.type] ?: "📄", fontSize = 22.sp)
                            Spacer(Modifier.width(12.dp))
                            Text(k.label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.weight(1f))
                            Text(Labels.prioLabel(k.prio).substringBefore(' '), color = Labels.prioColor(k.prio), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            1 -> {
                Text("Ubicación", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Plus Code (se captura del GPS en hardware)", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = plusCode, onValueChange = { plusCode = it },
                    label = { Text("Plus Code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = coarse, onCheckedChange = { coarse = it })
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text("Disminuir precisión", fontWeight = FontWeight.SemiBold)
                        Text("Celda de ~275 m para situaciones sensibles", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
                    }
                }
                val effective = if (coarse) PlusCode.coarse(plusCode) else plusCode
                Text("Se guardará: $effective", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                Spacer(Modifier.height(16.dp))
                Button(onClick = { step = 2 }, modifier = Modifier.fillMaxWidth()) { Text("Continuar") }
            }

            2 -> {
                Text("Detalles", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("Descripción") }, modifier = Modifier.fillMaxWidth(), minLines = 2,
                )
                Spacer(Modifier.height(8.dp))
                if (kind?.type == "need" || kind?.type == "sos") {
                    OutlinedTextField(
                        value = count, onValueChange = { count = it.filter { c -> c.isDigit() } },
                        label = { Text("Cantidad de personas (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Button(
                    onClick = {
                        val k = kind ?: return@Button
                        val code = if (coarse) PlusCode.coarse(plusCode) else plusCode
                        val payload = buildMap<String, Any?> {
                            if (note.isNotBlank()) put("note", note.trim())
                            if (k.severity != null) put("severity", k.severity)
                            count.toIntOrNull()?.let { put("count", it) }
                            put(if (coarse) "plus_code8" else "plus_code", code)
                        }
                        val rec = store.createReport(k.type, k.prio, payload)
                        onDone(rec.id)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Enviar · firmar y propagar a la malla")
                }
                Text(
                    "Se firma localmente con tu clave Ed25519 (${store.deviceId().take(10)}…). Sin cuenta ni nombre.",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}
