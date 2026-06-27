package baran.android.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import baran.android.BaranApplication
import baran.android.data.MeshStore

sealed interface Nav {
    data object Map : Nav
    data object Signals : Nav
    data object Profile : Nav
    data object Settings : Nav
    data object Create : Nav
    data class Detail(val id: String) : Nav
}

@Composable
fun MainNavHost(store: MeshStore = BaranApplication.instance.store) {
    var nav by remember { mutableStateOf<Nav>(Nav.Signals) }
    val signals by store.signals.collectAsState()

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = nav == Nav.Map, onClick = { nav = Nav.Map },
                    icon = { Text("🗺️") }, label = { Text("Mapa") },
                )
                NavigationBarItem(
                    selected = nav == Nav.Signals, onClick = { nav = Nav.Signals },
                    icon = { Text("📡") }, label = { Text("Señales") },
                )
                NavigationBarItem(
                    selected = nav == Nav.Profile, onClick = { nav = Nav.Profile },
                    icon = { Text("👤") }, label = { Text("Yo") },
                )
                NavigationBarItem(
                    selected = nav == Nav.Settings, onClick = { nav = Nav.Settings },
                    icon = { Text("⚙️") }, label = { Text("Ajustes") },
                )
            }
        },
        floatingActionButton = {
            if (nav !is Nav.Create && nav !is Nav.Detail) {
                ExtendedFloatingActionButton(
                    onClick = { nav = Nav.Create },
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                    text = { Text("Crear señal") },
                    icon = { Text("➕") },
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            when (val n = nav) {
                Nav.Map -> MapScreen(signals) { nav = Nav.Detail(it) }
                Nav.Signals -> SignalsScreen(signals) { nav = Nav.Detail(it) }
                Nav.Profile -> ProfileScreen(store)
                Nav.Settings -> SettingsScreen(store)
                Nav.Create -> CreateScreen(
                    store = store,
                    onDone = { id -> nav = if (id != null) Nav.Detail(id) else Nav.Signals },
                )
                is Nav.Detail -> {
                    val signal = signals.find { it.report.id == n.id }
                    if (signal == null) {
                        nav = Nav.Signals
                    } else {
                        DetailScreen(store = store, signal = signal, onBack = { nav = Nav.Signals })
                    }
                }
            }
        }
    }
}
