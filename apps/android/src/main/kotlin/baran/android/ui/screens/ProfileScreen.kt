package baran.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import baran.android.data.MeshStore

private val ROLES = listOf("Vecino/a", "Voluntario/a", "Equipo SAR", "Médico/a")

/** "Yo" — pseudonymous device identity, role, and local data controls. */
@Composable
fun ProfileScreen(store: MeshStore) {
    var role by remember { mutableStateOf(ROLES[0]) }
    val signalCount by store.signals.collectAsState()

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Mi dispositivo", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Identidad (Ed25519)", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                Text(store.deviceId(), fontFamily = FontFamily.Monospace, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Tu clave nunca se comparte. No hace falta nombre ni cuenta.",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Rol", fontWeight = FontWeight.SemiBold)
        Column(Modifier.selectableGroup()) {
            ROLES.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    RadioButton(selected = role == r, onClick = { role = r })
                    Text(r)
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Señales que conozco: ${signalCount.size}", fontWeight = FontWeight.SemiBold)
                Text("Duress PIN · respaldo de llaves — Fase 4", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline)
            }
        }

        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = { /* Phase 4: export CSV / wipe local */ }, modifier = Modifier.fillMaxWidth()) {
            Text("Exportar mis registros (CSV)")
        }
    }
}
