package baran.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import baran.android.data.MeshStore
import baran.android.ui.Labels
import baran.android.ui.components.BadgeRow
import baran.android.ui.components.Pill
import baran.domain.AttestationRecord

/**
 * Each action authors a SIGNED attestation; the tier/reach badges update live as
 * the fold recomputes. "Confirmar en sitio" runs the proximity-proof flow.
 */
@Composable
fun DetailScreen(store: MeshStore, signal: MeshStore.Signal, onBack: () -> Unit) {
    val r = signal.report
    var showOnSite by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Volver") }
            Spacer(Modifier.weight(1f))
            Pill("P${r.prio}", Labels.prioColor(r.prio))
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(Labels.typeEmoji[r.type] ?: "📄", fontSize = 26.sp)
            Text(Labels.typeLabel[r.type] ?: r.type, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        BadgeRow(signal.fold, signal.reach)
        Labels.tierDesc[signal.fold.tierName]?.let {
            Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(top = 6.dp))
        }

        Spacer(Modifier.height(12.dp))
        InfoRow("ID", r.id)
        InfoRow("Autor", r.authorId.take(16))
        InfoRow("HLC", r.hlc)
        InfoRow("Hash", r.contentHash.take(24) + "…")
        (r.payload["note"] ?: r.payload["msg"])?.let { InfoRow("Nota", it.toString()) }
        (r.payload["plus_code"] ?: r.payload["plus_code8"])?.let { InfoRow("Ubicación", it.toString()) }
        (r.payload["count"])?.let { InfoRow("Personas", it.toString()) }

        Spacer(Modifier.height(16.dp))
        Text("Atestaciones (${signal.attestations.size})", fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        if (signal.attestations.isEmpty()) {
            Text("Sin atestaciones aún.", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
        } else {
            signal.attestations.sortedBy { it.hlc }.forEach { AttestationRow(it) }
        }

        Spacer(Modifier.height(20.dp))
        Text("Acciones", fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("🤝 Corroborar", Color(0xFFF97316), Modifier.weight(1f)) { store.attest(r, "corroborate", "still_needs_help") }
                ActionButton("📍 En sitio", Color(0xFF3B82F6), Modifier.weight(1f)) { showOnSite = true }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("✅ A salvo", Color(0xFF16A34A), Modifier.weight(1f)) { store.attest(r, "resolve", "found_safe") }
                ActionButton("⚠ Disputar", Color(0xFFDC2626), Modifier.weight(1f)) { store.attest(r, "dispute", "false") }
            }
        }
        Text(
            "Tus acciones se firman localmente y se propagan por la malla.",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(top = 8.dp),
        )
    }

    if (showOnSite) {
        OnSiteDialog(
            reportPlusCode = (r.payload["plus_code"] ?: r.payload["plus_code8"])?.toString() ?: "",
            onDismiss = { showOnSite = false },
            onConfirm = { lat, lng ->
                val rpc = (r.payload["plus_code"] ?: r.payload["plus_code8"])?.toString() ?: ""
                val proof = store.onSiteProof(lat, lng, rpc)
                store.attest(r, "on_site", "still_needs_help", proof)
                showOnSite = false
            },
        )
    }
}

@Composable
private fun OnSiteDialog(reportPlusCode: String, onDismiss: () -> Unit, onConfirm: (Double, Double) -> Unit) {
    var lat by remember { mutableStateOf("10.5") }
    var lng by remember { mutableStateOf("-66.9") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Confirmar en sitio") },
        text = {
            Column {
                Text("En hardware esto usa tu GPS preciso. La prueba demuestra que tu ubicación cae dentro de la celda del reporte ($reportPlusCode).", fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = lat, onValueChange = { lat = it }, label = { Text("Latitud") }, singleLine = true)
                OutlinedTextField(value = lng, onValueChange = { lng = it }, label = { Text("Longitud") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val la = lat.toDoubleOrNull(); val lo = lng.toDoubleOrNull()
                if (la != null && lo != null) onConfirm(la, lo)
            }) { Text("Firmar prueba") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
private fun AttestationRow(a: AttestationRecord) {
    val color = when {
        a.attType == "dispute" || a.fact == "false" -> Color(0xFFDC2626)
        a.attType == "resolve" || a.fact == "found_safe" -> Color(0xFF16A34A)
        a.attType in listOf("on_site", "device_confirm", "self_confirm") -> Color(0xFF3B82F6)
        else -> Color(0xFF475569)
    }
    Card(shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Column(Modifier.padding(10.dp)) {
            Text(
                "${Labels.attLabel[a.attType] ?: a.attType} · ${Labels.factLabel[a.fact] ?: a.fact}",
                color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            )
            Text("${a.claimerId.take(12)} · seq ${a.claimerSeq}", fontSize = 10.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.outline)
            a.proof?.let { p ->
                val match = p["match"]
                if (match != null) Text("prueba: ${p["type"]} · coincide: ${if (match == true) "sí" else "no"} · ${p["plus_code8"] ?: ""}", fontSize = 10.sp, color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.padding(vertical = 2.dp)) {
        Text("$label: ", color = MaterialTheme.colorScheme.outline, fontSize = 12.sp)
        Text(value, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun ActionButton(label: String, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, colors = ButtonDefaults.buttonColors(containerColor = color), shape = RoundedCornerShape(8.dp), modifier = modifier) {
        Text(label, fontSize = 13.sp)
    }
}
