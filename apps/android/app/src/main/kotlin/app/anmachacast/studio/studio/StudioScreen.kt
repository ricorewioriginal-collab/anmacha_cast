package app.anmachacast.studio.studio

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import app.anmachacast.studio.data.SourceDto
import app.anmachacast.studio.ui.theme.BrandBad
import app.anmachacast.studio.ui.theme.BrandGood
import app.anmachacast.studio.ui.theme.BrandWarn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StudioScreen(viewModel: StudioViewModel = viewModel()) {
    val ui by viewModel.ui.collectAsState()

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0),
                title = { Text(ui.station?.name?.ifBlank { null } ?: "Studio") },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Aktualisieren")
                    }
                },
            )
        },
    ) { padding ->
        when {
            ui.loading && ui.station == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            ui.error != null && ui.station == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(ui.error ?: "Fehler", color = MaterialTheme.colorScheme.error)
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item { ConnectionBanner(ui.connectionPhase, ui.error) }
                item { NowPlayingCard(ui) }
                item { PlayoutCard(ui) }
                ui.stationId?.let { sid -> item { CardwallSection(sid) } }
                item { Text("Quellen", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                items(ui.sources) { source ->
                    SourceRow(
                        source = source,
                        busy = ui.busySourceId == source.id,
                        onTakeover = { force -> viewModel.takeover(source.id, force) },
                        onRelease = { viewModel.release(source.id) },
                    )
                }
                item { Text("Warteschlange", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                if (ui.queue.isEmpty()) {
                    item { Text("Keine Einträge in der Warteschlange.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    items(ui.queue) { item ->
                        ListItem(
                            headlineContent = { Text(item.media?.title?.ifBlank { null } ?: item.mediaId) },
                            supportingContent = { item.media?.artist?.takeIf { it.isNotBlank() }?.let { Text(it) } },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectionBanner(phase: ConnectionPhase, error: String?) {
    if (phase == ConnectionPhase.CONNECTED) return
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
        Text(
            error ?: "Verbindung getrennt - versuche erneut zu verbinden…",
            modifier = Modifier.padding(12.dp),
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

@Composable
private fun NowPlayingCard(ui: StudioUiState) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("Jetzt läuft", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            val media = ui.nowPlaying?.media
            Text(media?.title?.ifBlank { null } ?: "Keine Daten", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            media?.artist?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun PlayoutCard(ui: StudioUiState) {
    val playout = ui.playout ?: return
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("Encoder", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(playout.encoder?.ifBlank { null } ?: "-", style = MaterialTheme.typography.bodyLarge)
            }
            Column {
                Text("Format", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    listOfNotNull(playout.format, playout.bitrateKbps?.let { "${it} kbps" }).joinToString(" · ").ifBlank { "-" },
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("Status", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val (label, color) = when {
                    playout.silent -> "Stille" to BrandBad
                    playout.running -> "On Air" to BrandGood
                    else -> "Gestoppt" to BrandWarn
                }
                Text(label, color = color, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun SourceRow(source: SourceDto, busy: Boolean, onTakeover: (Boolean) -> Unit, onRelease: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(12.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(source.name.ifBlank { source.id }, fontWeight = FontWeight.SemiBold)
                Text(
                    "${source.type} · ${source.state}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (source.healthy) MaterialTheme.colorScheme.onSurfaceVariant else BrandBad,
                )
            }
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else if (source.state == "active") {
                OutlinedButton(onClick = onRelease) { Text("Freigeben") }
            } else {
                Button(onClick = { onTakeover(false) }) { Text("Übernehmen") }
            }
        }
    }
}

/** Cardwall nativ: Tasten wie im Web/Windows (Farbe, Beschriftung), Tippen = abspielen, „Alle stoppen“. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardwallSection(stationId: String) {
    val repo = (androidx.compose.ui.platform.LocalContext.current.applicationContext as app.anmachacast.studio.AnMaChaCastApp).connectionRepository
    val scope = rememberCoroutineScope()
    var slots by remember { mutableStateOf<List<app.anmachacast.studio.data.CartSlotDto>>(emptyList()) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(stationId) { slots = runCatching { repo.api.cardwall(stationId) }.getOrDefault(emptyList()) }
    val used = slots.filter { !it.mediaId.isNullOrBlank() }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cardwall", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = { scope.launch { info = runCatching { repo.api.stopCarts(stationId); "Alle Carts gestoppt" }.getOrElse { it.message } } }) { Text("■ Alle stoppen") }
        }
        if (used.isEmpty()) Text("Keine Carts belegt – belegen im Web-Studio oder in der Windows-App (Rechtsklick auf eine Taste).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            used.forEach { slot ->
                val color = runCatching { Color(android.graphics.Color.parseColor(slot.color ?: "#38BDF8")) }.getOrDefault(Color(0xFF38BDF8))
                Button(
                    onClick = { scope.launch { info = runCatching { repo.api.triggerCart(stationId, slot.id); "▶ " + slot.label.ifBlank { "Cart" } }.getOrElse { it.message } } },
                    colors = ButtonDefaults.buttonColors(containerColor = color.copy(alpha = 0.85f), contentColor = Color.White),
                ) { Text(slot.label.ifBlank { "Cart" }) }
            }
        }
        info?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
