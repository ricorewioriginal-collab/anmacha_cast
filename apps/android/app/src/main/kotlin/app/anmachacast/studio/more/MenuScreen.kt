// Menü des Bereichs „Server / Studio“: dieselben Abschnitte, Namen und Reihenfolge wie im Web-Studio und in der
// Windows-App (studio/index.html, apps/windows/MainWindow.cs NavInfo), mit Einfach-/Profi-Ansicht. Was die App nativ
// kann (Live-Studio mit Cardwall, Hörer & Interaktion, KI-Programmchef, Server), öffnet den nativen Bildschirm; alles andere zeigt die Seite des verbundenen Servers in der
// App (WebStudioScreen, Web-Studio im Einbett-Modus) – kein „noch nicht verfügbar“ mehr, alles ist erreichbar.
package app.anmachacast.studio.more

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Ziel eines Menüeintrags: nativer Bildschirm oder eine Ansicht des Web-Studios (view/sub wie in studio/index.html). */
sealed class MenuTarget {
    data object LiveStudio : MenuTarget()
    data object Server : MenuTarget()
    data object Listeners : MenuTarget()
    data object Programmchef : MenuTarget()
    data class Web(val title: String, val view: String, val sub: String = "") : MenuTarget()
}

data class MenuEntry(val section: String, val title: String, val icon: ImageVector, val pro: Boolean, val target: MenuTarget)

private fun web(section: String, title: String, icon: ImageVector, view: String, sub: String = "", pro: Boolean = false) =
    MenuEntry(section, title, icon, pro, MenuTarget.Web(title, view, sub))

/** Reihenfolge und Einteilung wie in Web und Windows. */
val MENU: List<MenuEntry> = listOf(
    MenuEntry("Start", "Live-Studio", Icons.Filled.SettingsInputAntenna, false, MenuTarget.LiveStudio),
    web("Start", "Sendezentrale", Icons.Filled.Dashboard, "overview"),
    web("laut.fm", "laut.fm verwalten", Icons.Filled.Headphones, "lautfm"),
    MenuEntry("laut.fm", "KI-Programmchef", Icons.Filled.Bolt, false, MenuTarget.Programmchef),
    web("laut.fm", "Playlist-Pflege", Icons.Filled.Tune, "lautfm", "pflege"),
    web("laut.fm", "Wunschstunde & Jingles", Icons.Filled.Mic, "lautfm", "hoerer"),
    web("Musik", "Mediathek", Icons.Filled.LibraryMusic, "mediathek"),
    web("Musik", "Playlisten", Icons.AutoMirrored.Filled.QueueMusic, "playlists"),
    web("Musik", "Jingles & IDs", Icons.Filled.ViewModule, "jingles"),
    web("Musik", "Voice Studio", Icons.Filled.RecordVoiceOver, "voice", pro = true),
    web("Musik", "Bibliothek-Werkzeuge", Icons.Filled.Build, "playlists", "lifehacks", pro = true),
    web("Musik", "Podcast", Icons.Filled.Podcasts, "recorder", "podcast", pro = true),
    web("Musik", "Cast Tools", Icons.Filled.Apps, "tools", pro = true),
    web("KI & Statistik", "Hörerstatistik", Icons.Filled.BarChart, "stats"),
    MenuEntry("KI & Statistik", "Hörer & Interaktion", Icons.Filled.Forum, false, MenuTarget.Listeners),
    web("KI & Statistik", "KI-Studio & Anbieter", Icons.Filled.AutoAwesome, "ai"),
    web("KI & Statistik", "Berichte", Icons.Filled.Assessment, "recorder", "recap", pro = true),
    web("Senden", "Encoder & Quellen", Icons.Filled.CellTower, "studio"),
    web("Senden", "Verbreitung", Icons.Filled.Public, "bridges", pro = true),
    web("Programm planen", "Sendeplan", Icons.Filled.CalendarMonth, "planning"),
    web("Programm planen", "Sendeuhr", Icons.Filled.Schedule, "planning", "clock"),
    web("Programm planen", "Ereignisse & Ansagen", Icons.Filled.Campaign, "planning", "events", pro = true),
    web("Programm planen", "Smart Blocks & Rotation", Icons.Filled.Shuffle, "planning", "rotation", pro = true),
    web("Programm planen", "Nachrichten & Wetter", Icons.Filled.Newspaper, "news"),
    web("Programm planen", "News-Zentrale", Icons.Filled.Description, "showprep"),
    web("Programm planen", "Aufnahme & Mitschnitte", Icons.Filled.FiberManualRecord, "recorder", pro = true),
    web("Einstellungen", "Benutzer & Rollen", Icons.Filled.Group, "users", pro = true),
    web("Einstellungen", "Mein Profil & API", Icons.Filled.Person, "profile", pro = true),
    web("Einstellungen", "Hilfe & Handbuch", Icons.Filled.Info, "handbuch"),
    MenuEntry("Server & Geräte", "Server & Verbindung", Icons.Filled.Dns, false, MenuTarget.Server),
)

/** Einfach/Profi gilt wie im Web je Gerät und bleibt gespeichert. */
object MenuMode {
    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences("anmachacast_ui", Context.MODE_PRIVATE)
    fun pro(c: Context): Boolean = prefs(c).getBoolean("menu_pro", false)
    fun setPro(c: Context, pro: Boolean) = prefs(c).edit().putBoolean("menu_pro", pro).apply()
}

/** Sichtbare Einträge je Abschnitt (Abschnitte ohne Eintrag entfallen). */
fun visibleMenu(pro: Boolean): List<Pair<String, List<MenuEntry>>> =
    MENU.filter { pro || !it.pro }.groupBy { it.section }.toList()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MenuScreen(onOpen: (MenuTarget) -> Unit) {
    val ctx = LocalContext.current
    var pro by remember { mutableStateOf(MenuMode.pro(ctx)) }
    Scaffold(contentWindowInsets = WindowInsets(0), topBar = {
        TopAppBar(windowInsets = WindowInsets(0), title = { Text("Menü") }, actions = {
            SingleChoiceSegmentedButtonRow(Modifier.padding(end = 8.dp)) {
                SegmentedButton(selected = !pro, onClick = { pro = false; MenuMode.setPro(ctx, false) }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Einfach") }
                SegmentedButton(selected = pro, onClick = { pro = true; MenuMode.setPro(ctx, true) }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Profi") }
            }
        })
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            visibleMenu(pro).forEach { (section, entries) ->
                item(key = "h-$section") {
                    Text(
                        section.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                    )
                }
                items(entries, key = { "${it.section}-${it.title}" }) { e ->
                    ListItem(
                        headlineContent = { Text(e.title) },
                        leadingContent = { Icon(e.icon, contentDescription = null) },
                        trailingContent = if (e.target is MenuTarget.Web) null else ({ Icon(Icons.Filled.ChevronRight, null) }),
                        modifier = Modifier.clickable { onOpen(e.target) },
                    )
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}
