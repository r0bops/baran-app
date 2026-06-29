@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.net.PfifPersons
import venrescate.android.net.PublicNews

/** "Personas" — centralized PFIF directory (missing/found/deceased) + press feed.
 *  [initialArea] pre-filters the list to a neighborhood (set when a map bubble is tapped). */
@Composable
fun PersonsScreen(initialArea: String? = null) {
    var tab by remember { mutableStateOf(0) }
    var stats by remember { mutableStateOf<PfifPersons.Stats?>(null) }
    LaunchedEffect(Unit) { stats = PfifPersons.stats() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Personas", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Directorio centralizado · PFIF · VenezuelaTeBusca",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        Spacer(Modifier.height(10.dp))

        stats?.let { s ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    StatCell("Desaparecidas", s.missing, MaterialTheme.colorScheme.error)
                    StatCell("Encontradas", s.found, MaterialTheme.colorScheme.secondary)
                    StatCell("Fallecidas", s.deceased, MaterialTheme.colorScheme.onSurfaceVariant)
                    StatCell("Total", s.total, MaterialTheme.colorScheme.primary)
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Buscar") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Noticias") })
        }
        Spacer(Modifier.height(12.dp))

        if (tab == 0) PersonsDirectory(initialArea) else NewsFeed()
    }
}

@Composable
private fun RowScope.StatCell(label: String, value: Int, color: androidx.compose.ui.graphics.Color) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("%,d".format(value), style = MaterialTheme.typography.titleLarge, color = color)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PersonsDirectory(initialArea: String?) {
    var area by remember { mutableStateOf(initialArea) }
    var query by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var people by remember { mutableStateOf<List<PfifPersons.Person>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(area, query, status) {
        loading = true
        people = when {
            area != null -> PfifPersons.byLocality(area!!).let { list ->
                if (status == null) list else list.filter { it.status == status }
            }
            else -> PfifPersons.list(query = query, status = status)
        }
        loading = false
    }

    area?.let {
        AssistChip(
            onClick = { area = null },
            label = { Text("Área: $it  ✕") },
            modifier = Modifier.padding(bottom = 8.dp),
        )
    }
    if (area == null) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Buscar por nombre o lugar") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = status == null, onClick = { status = null }, label = { Text("Todas") })
        FilterChip(selected = status == "missing", onClick = { status = "missing" }, label = { Text("Desaparecidas") })
        FilterChip(selected = status == "found", onClick = { status = "found" }, label = { Text("Encontradas") })
    }
    Spacer(Modifier.height(8.dp))

    if (loading) {
        Text("Cargando…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
    } else if (people.isEmpty()) {
        Text("Sin resultados.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 96.dp)) {
            items(people, key = { it.id }) { p ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val found = p.status == "found"
                            Text(if (found) "✅" else if (p.status == "deceased") "🕯️" else "🔍")
                            Spacer(Modifier.width(8.dp))
                            Text(p.fullName.ifBlank { "—" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Text(
                                when (p.status) { "found" -> "encontrada"; "deceased" -> "fallecida"; else -> "se busca" },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (found) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error,
                            )
                        }
                        val meta = listOfNotNull(
                            p.age?.let { "$it años" },
                            p.gender.takeIf { it.isNotBlank() }?.let { if (it == "male") "M" else if (it == "female") "F" else it },
                            p.lastSeenLocation.takeIf { it.isNotBlank() },
                            p.hospital.takeIf { it.isNotBlank() }?.let { "🏥 $it" },
                        )
                        if (meta.isNotEmpty()) {
                            Spacer(Modifier.height(4.dp))
                            Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NewsFeed() {
    val context = LocalContext.current
    var news by remember { mutableStateOf<List<PublicNews.Item>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        news = PublicNews.fetch()
        loading = false
    }
    if (loading) {
        Text("Cargando…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
    } else if (news.isEmpty()) {
        Text("Sin noticias por ahora.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 96.dp)) {
            items(news) { n ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable {
                        if (n.url.isNotBlank()) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(n.url))) }
                    },
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(n.title, style = MaterialTheme.typography.titleMedium, fontSize = 14.sp)
                        if (n.summary.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(n.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            listOf(n.source, n.publishedAt.take(10)).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }
    }
}
