@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package venrescate.android.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import venrescate.android.net.PublicNews
import venrescate.android.net.PublicPersons

/** "Personas" — public SOS Venezuela 2026 directory (missing / found) + press feed. */
@Composable
fun PersonsScreen() {
    var tab by remember { mutableStateOf(0) } // 0 = personas, 1 = noticias
    var stats by remember { mutableStateOf<PublicPersons.Stats?>(null) }

    LaunchedEffect(Unit) { stats = PublicPersons.stats() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Personas", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(
            "Directorio público · SOS Venezuela 2026",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(10.dp))

        stats?.let { s ->
            Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    StatCell("Desaparecidas", s.missing, "${s.missingMinors} menores", MaterialTheme.colorScheme.error)
                    StatCell("Encontradas", s.found, "${s.foundMinors} menores", MaterialTheme.colorScheme.secondary)
                    StatCell("Total", s.total, "registros", MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Buscar") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Noticias") })
        }
        Spacer(Modifier.height(12.dp))

        if (tab == 0) PersonsDirectory() else NewsFeed()
    }
}

@Composable
private fun RowScope.StatCell(label: String, value: Int, sub: String, color: androidx.compose.ui.graphics.Color) {
    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("%,d".format(value), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = color)
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface)
        Text(sub, fontSize = 10.sp, color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun PersonsDirectory() {
    var query by remember { mutableStateOf("") }
    var estado by remember { mutableStateOf<String?>(null) }
    var people by remember { mutableStateOf<List<PublicPersons.Person>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(query, estado) {
        loading = true
        people = PublicPersons.list(q = query, estado = estado)
        loading = false
    }

    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        label = { Text("Buscar por nombre (mín. 2 letras)") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = estado == null, onClick = { estado = null }, label = { Text("Todas") })
        FilterChip(selected = estado == "seeking_info", onClick = { estado = "seeking_info" }, label = { Text("Desaparecidas") })
        FilterChip(selected = estado == "found_alive", onClick = { estado = "found_alive" }, label = { Text("Encontradas") })
    }
    Spacer(Modifier.height(8.dp))

    if (loading) {
        Text("Cargando…", color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(24.dp))
    } else if (people.isEmpty()) {
        Text("Sin resultados.", color = MaterialTheme.colorScheme.outline)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(people) { p ->
                Card(shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val found = p.status == "found_alive"
                            Text(if (found) "✅" else "🔍")
                            Spacer(Modifier.width(8.dp))
                            Text(p.displayName.ifBlank { "—" }, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text(
                                if (found) "encontrada" else "se busca",
                                fontSize = 11.sp,
                                color = if (found) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error,
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            listOf(p.cedulaMasked, p.municipio, p.hospitalName).filter { it.isNotBlank() }.joinToString(" · "),
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace,
                        )
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
        Text("Cargando…", color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(24.dp))
    } else if (news.isEmpty()) {
        Text("Sin noticias por ahora.", color = MaterialTheme.colorScheme.outline)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(news) { n ->
                Card(
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().clickable {
                        if (n.url.isNotBlank()) {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(n.url))) }
                        }
                    },
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(n.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        if (n.summary.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(n.summary, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            listOf(n.source, n.publishedAt.take(10)).filter { it.isNotBlank() }.joinToString(" · "),
                            fontSize = 10.sp, color = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }
    }
}
