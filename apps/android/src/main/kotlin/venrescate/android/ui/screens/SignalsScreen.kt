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
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp).padding(top = 16.dp)) {
        Text("Señales", style = MaterialTheme.typography.headlineSmall)
        Text(
            "${signals.size} en la malla · ordenadas por prioridad",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp, bottom = 12.dp),
        )
        if (signals.isEmpty()) {
            EmptyState()
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(bottom = 96.dp), // clear the FAB
            ) {
                items(signals, key = { it.report.id }) { SignalCard(it, onOpen) }
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(bottom = 64.dp),
        ) {
            Text("📡", fontSize = 40.sp)
            Spacer(Modifier.height(12.dp))
            Text("Aún no hay señales", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "Crea la primera con «Crear señal», o espera a que lleguen por la malla.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
        }
    }
}

@Composable
private fun SignalCard(s: MeshStore.Signal, onOpen: (String) -> Unit) {
    val r = s.report
    Card(
        onClick = { onOpen(r.id) },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(Labels.typeEmoji[r.type] ?: "📄", fontSize = 22.sp)
                Text(
                    Labels.typeLabel[r.type] ?: r.type,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                Pill("P${r.prio}", Labels.prioColor(r.prio))
            }
            val note = (r.payload["note"] ?: r.payload["msg"] ?: r.payload["name"] ?: "").toString()
            if (note.isNotEmpty()) {
                Text(
                    note,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 8.dp, bottom = 10.dp),
                )
            } else {
                Spacer(Modifier.height(10.dp))
            }
            BadgeRow(s.fold, s.reach)
            if (s.attestations.isNotEmpty()) {
                Text(
                    "${s.attestations.size} atestación(es)",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
    }
}
