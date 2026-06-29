@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.data.MeshStore
import venrescate.android.ui.Labels
import venrescate.android.ui.components.BadgeRow
import venrescate.android.ui.components.Pill

@Composable
fun SignalsScreen(signals: List<MeshStore.Signal>, onOpen: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Señales", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(
            "${signals.size} en la malla · ordenadas por prioridad",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        if (signals.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Sin señales aún. Usa «Crear señal».", color = MaterialTheme.colorScheme.outline)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(signals, key = { it.report.id }) { SignalCard(it, onOpen) }
            }
        }
    }
}

@Composable
private fun SignalCard(s: MeshStore.Signal, onOpen: (String) -> Unit) {
    val r = s.report
    Card(
        onClick = { onOpen(r.id) },
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(Labels.typeEmoji[r.type] ?: "📄", fontSize = 20.sp)
                Text(
                    Labels.typeLabel[r.type] ?: r.type,
                    fontWeight = FontWeight.Bold, fontSize = 16.sp,
                    modifier = Modifier.weight(1f),
                )
                Pill("P${r.prio}", Labels.prioColor(r.prio))
            }
            val note = (r.payload["note"] ?: r.payload["msg"] ?: r.payload["name"] ?: "").toString()
            if (note.isNotEmpty()) {
                Text(note, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 6.dp))
            }
            BadgeRow(s.fold, s.reach)
            if (s.attestations.isNotEmpty()) {
                Text(
                    "${s.attestations.size} atestación(es)",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}
