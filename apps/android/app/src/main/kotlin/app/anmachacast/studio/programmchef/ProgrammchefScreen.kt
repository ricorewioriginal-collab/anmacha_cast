// KI-Programmchef für laut.fm nativ: Autopilot mit eigener Vorgabe ein/aus, Takt, jetzt ausführen, letzte Änderung
// rückgängig und Protokoll. Dieselbe API wie Web und Windows (/stations/:sid/programmchef). Sendeplaner im Detail,
// Playlist-Pflege und Wunschstunde öffnen über das Menü die Seiten des Servers.
package app.anmachacast.studio.programmchef

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.data.ProgrammchefDto
import app.anmachacast.studio.ui.theme.BrandBad
import app.anmachacast.studio.ui.theme.BrandGood
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val EVERY = listOf(6 to "alle 6 Stunden", 12 to "alle 12 Stunden", 24 to "täglich", 48 to "alle 2 Tage", 168 to "wöchentlich")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgrammchefScreen(onBack: () -> Unit) {
    val repo = (LocalContext.current.applicationContext as AnMaChaCastApp).connectionRepository
    val scope = rememberCoroutineScope()
    var station by remember { mutableStateOf<String?>(null) }
    var st by remember { mutableStateOf<ProgrammchefDto?>(null) }
    var brief by remember { mutableStateOf("") }
    var every by remember { mutableStateOf(24) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var everyOpen by remember { mutableStateOf(false) }

    suspend fun load(fillForm: Boolean) {
        val sid = station ?: repo.api.stationOf(repo.connection.value?.stationIds ?: emptyList()).also { station = it }
        if (sid == null) { error = "Kein Sender für dieses Gerät freigegeben."; return }
        runCatching { repo.api.programmchef(sid) }
            .onSuccess {
                st = it
                error = null
                if (fillForm) { brief = it.autopilot.brief; every = it.autopilot.everyHours }
            }
            .onFailure { error = if ((it as? app.anmachacast.studio.data.ApiException)?.status == 403) "Für den KI-Programmchef fehlen diesem Gerät die laut.fm-Rechte." else it.message }
    }

    fun run(ok: String, block: suspend (String) -> Unit) {
        val sid = station ?: return
        scope.launch {
            busy = true
            runCatching { block(sid) }.onSuccess { message = ok }.onFailure { message = it.message }
            busy = false
            load(false)
        }
    }

    LaunchedEffect(Unit) {
        load(true)
        // während der Autopilot arbeitet, alle 5 s nachsehen, sonst alle 30 s
        while (true) { delay(if (st?.autopilot?.running == true) 5_000 else 30_000); load(false) }
    }

    Scaffold(contentWindowInsets = WindowInsets(0), topBar = {
        TopAppBar(
            windowInsets = WindowInsets(0), title = { Text("KI-Programmchef") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück zum Menü") } },
            actions = { IconButton(onClick = { scope.launch { load(false) } }) { Icon(Icons.Filled.Refresh, "Neu laden") } },
        )
    }) { padding ->
        val s = st
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { e -> item { Text(e, color = MaterialTheme.colorScheme.error) } }
            message?.let { m -> item { Text(m, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) } }
            if (s == null) {
                if (error == null) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                return@LazyColumn
            }
            if (!s.ai) item { Text("Noch kein KI-Anbieter für diesen Sender eingerichtet – Menü → KI-Studio & Anbieter.", color = MaterialTheme.colorScheme.error) }
            item {
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Autopilot", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text(
                                    if (s.autopilot.running) "● arbeitet gerade …" else if (s.autopilot.enabled) "an · " + (EVERY.firstOrNull { it.first == s.autopilot.everyHours }?.second ?: "") else "aus",
                                    color = if (s.autopilot.enabled) BrandGood else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Switch(checked = s.autopilot.enabled, enabled = !busy, onCheckedChange = { on ->
                                run(if (on) "Autopilot eingeschaltet" else "Autopilot ausgeschaltet") { sid -> repo.api.setAutopilot(sid, on, brief.trim(), every) }
                            })
                        }
                        OutlinedTextField(
                            value = brief, onValueChange = { brief = it }, minLines = 3, modifier = Modifier.fillMaxWidth(),
                            label = { Text("Dein Programm in eigenen Worten") },
                            placeholder = { Text("z. B. Tagsüber aktuelle Hits, abends Rock, am Wochenende 90er") },
                        )
                        ExposedDropdownMenuBox(expanded = everyOpen, onExpandedChange = { everyOpen = it }) {
                            OutlinedTextField(
                                value = EVERY.firstOrNull { it.first == every }?.second ?: "", onValueChange = {}, readOnly = true, label = { Text("Auffrischen") },
                                modifier = Modifier.menuAnchor().fillMaxWidth(),
                            )
                            ExposedDropdownMenu(expanded = everyOpen, onDismissRequest = { everyOpen = false }) {
                                EVERY.forEach { (h, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { every = h; everyOpen = false }) }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = !busy && brief.isNotBlank(), onClick = {
                                run("Vorgabe gespeichert") { sid -> repo.api.setAutopilot(sid, s.autopilot.enabled, brief.trim(), every) }
                            }) { Text("Speichern") }
                            OutlinedButton(enabled = !busy && !s.autopilot.running && s.autopilot.brief.isNotBlank(), onClick = {
                                run("Autopilot läuft – Playlisten werden aufgefrischt") { sid -> repo.api.runAutopilot(sid) }
                            }) { Text("Jetzt ausführen") }
                        }
                        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                }
            }
            s.undo?.let { u ->
                item {
                    ElevatedCard(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Letzte Änderung", fontWeight = FontWeight.SemiBold)
                                Text(u.summary, style = MaterialTheme.typography.bodySmall)
                            }
                            OutlinedButton(enabled = !busy, onClick = { run("Rückgängig gemacht") { sid -> repo.api.undoProgrammchef(sid) } }) { Text("Rückgängig") }
                        }
                    }
                }
            }
            item { Text("Protokoll", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            if (s.log.isEmpty()) item { Text("Noch keine Einträge.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(s.log.take(50)) { e ->
                val time = SimpleDateFormat("dd.MM. HH:mm", Locale.GERMANY).format(Date(e.at))
                ListItem(
                    headlineContent = { Text(e.text) },
                    supportingContent = { Text("$time · ${e.kind}", color = if (e.ok) MaterialTheme.colorScheme.onSurfaceVariant else BrandBad) },
                )
            }
        }
    }
}
