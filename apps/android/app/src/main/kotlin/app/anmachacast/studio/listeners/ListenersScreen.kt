// Hörer & Interaktion nativ: Posteingang mit Musikwünschen, Grüßen, Sprachnachrichten und Studiomail – einreihen,
// auf Sendung bringen (laut.fm/Live, wie im Web), per Mail antworten, erledigen, löschen. Dieselbe API wie Web und Windows
// (/stations/:sid/inbox), keine eigenen Daten. Was nur im Web geht (Umfragen, Widgets, Einstellungen), öffnet das Menü.
package app.anmachacast.studio.listeners

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
import app.anmachacast.studio.data.InboxItemDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun kindLabel(k: String) = when (k) { "request" -> "Musikwunsch"; "voice" -> "Sprachnachricht"; else -> "Gruß / Nachricht" }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListenersScreen(onBack: () -> Unit) {
    val repo = (LocalContext.current.applicationContext as AnMaChaCastApp).connectionRepository
    val scope = rememberCoroutineScope()
    var station by remember { mutableStateOf<String?>(null) }
    var items by remember { mutableStateOf<List<InboxItemDto>>(emptyList()) }
    var showDone by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var replyTo by remember { mutableStateOf<InboxItemDto?>(null) }
    var loading by remember { mutableStateOf(true) }

    suspend fun load() {
        val sid = station ?: repo.api.stationOf(repo.connection.value?.stationIds ?: emptyList()).also { station = it }
        if (sid == null) { error = "Kein Sender für dieses Gerät freigegeben."; loading = false; return }
        runCatching { repo.api.inbox(sid) }
            .onSuccess { items = it.items.sortedByDescending { x -> x.at }; error = null }
            .onFailure { error = it.message }
        loading = false
    }

    fun act(item: InboxItemDto, action: String, text: String? = null, ok: String) {
        val sid = station ?: return
        scope.launch {
            busy = item.id
            runCatching { repo.api.inboxAction(sid, item.id, action, text) }
                .onSuccess { message = ok }
                .onFailure { message = it.message }
            busy = null
            load()
        }
    }

    // alle 15 s neu laden, solange der Bildschirm offen ist (spart gegenüber Dauerverbindung Akku)
    LaunchedEffect(Unit) { while (true) { load(); delay(15_000) } }

    Scaffold(contentWindowInsets = WindowInsets(0), topBar = {
        TopAppBar(
            windowInsets = WindowInsets(0), title = { Text("Hörer & Interaktion") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück zum Menü") } },
            actions = { IconButton(onClick = { scope.launch { load() } }) { Icon(Icons.Filled.Refresh, "Neu laden") } },
        )
    }) { padding ->
        val shown = items.filter { showDone || it.status == "new" }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${items.count { it.status == "new" }} neu", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text("Erledigte zeigen", style = MaterialTheme.typography.bodySmall)
                    Switch(checked = showDone, onCheckedChange = { showDone = it }, modifier = Modifier.padding(start = 8.dp))
                }
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
            if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            else if (shown.isEmpty() && error == null) item { Text("Keine neuen Hörer-Nachrichten.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(shown, key = { it.id }) { it2 -> InboxCard(it2, busy == it2.id, ::act) { replyTo = it2 } }
        }
    }

    replyTo?.let { item ->
        var text by remember(item.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { replyTo = null },
            title = { Text("Antwort an ${item.name ?: item.email}") },
            text = { OutlinedTextField(value = text, onValueChange = { text = it }, minLines = 4, modifier = Modifier.fillMaxWidth(), label = { Text("Nachricht") }) },
            confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { replyTo = null; act(item, "reply", text.trim(), "Antwort gesendet") }) { Text("Senden") } },
            dismissButton = { TextButton(onClick = { replyTo = null }) { Text("Abbrechen") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InboxCard(item: InboxItemDto, busy: Boolean, act: (InboxItemDto, String, String?, String) -> Unit, onReply: () -> Unit) {
    val time = remember(item.at) { SimpleDateFormat("dd.MM. HH:mm", Locale.GERMANY).format(Date(item.at)) }
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${kindLabel(item.kind)} · $time" + (if (item.source == "mail") " · Studiomail" else "") + (if (item.status == "done") " · erledigt" else ""),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(item.name?.ifBlank { null } ?: "Anonym", fontWeight = FontWeight.SemiBold)
            (item.title ?: item.subject)?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium) }
            item.text?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.kind == "request" && (item.mediaId != null || item.wishId != null)) Button(onClick = { act(item, "queue", null, "Wunsch eingereiht") }) { Text("Einreihen") }
                if (item.kind != "request") Button(onClick = { act(item, "air", null, "Auf Sendung gebracht") }) { Text("Auf Sendung") }
                if (!item.email.isNullOrBlank()) OutlinedButton(onClick = onReply) { Text("Antworten") }
                if (item.status == "new") OutlinedButton(onClick = { act(item, "done", null, "Erledigt") }) { Text("Erledigt") }
                TextButton(onClick = { act(item, "delete", null, "Gelöscht") }) { Text("Löschen") }
            }
        }
    }
}
