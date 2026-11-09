// Navigation der App als einfacher Zustand (aktueller Bereich + Reiter) statt Back-Stack: Reiterwechsel und
// Wechsel der Betriebsart sind damit immer eindeutig. Zurück: erst auf den ersten Reiter, dann zum Startbildschirm.
package app.anmachacast.studio.nav

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.common.WebStudio
import app.anmachacast.studio.common.WebStudioScreen
import app.anmachacast.studio.connect.ConnectScreen
import app.anmachacast.studio.connect.ConnectionStatusViewModel
import app.anmachacast.studio.golive.GoLiveViewModel
import app.anmachacast.studio.golive.LautFmLoginScreen
import app.anmachacast.studio.golive.LiveScreen
import app.anmachacast.studio.golive.MusicScreen
import app.anmachacast.studio.golive.SetupScreen
import app.anmachacast.studio.home.HomeScreen
import app.anmachacast.studio.more.MenuScreen
import app.anmachacast.studio.more.MenuTarget
import app.anmachacast.studio.radioadmin.RaManageScreen
import app.anmachacast.studio.radioadmin.RaOverviewScreen
import app.anmachacast.studio.radioadmin.RaProgramScreen
import app.anmachacast.studio.radioadmin.RaScheduleScreen
import app.anmachacast.studio.radioadmin.RaStatsScreen
import app.anmachacast.studio.radioadmin.RadioadminViewModel
import app.anmachacast.studio.start.StartScreen
import app.anmachacast.studio.studio.StudioScreen

/** Bereiche der App. START ist der Startbildschirm, alles andere gehört zu einer Betriebsart. */
private enum class Screen(val mode: Mode?) {
    START(null),
    LIVE(Mode.GOLIVE), MUSIC(Mode.GOLIVE), SETUP(Mode.GOLIVE),
    HOME(Mode.STUDIO), STUDIO(Mode.STUDIO), MENU(Mode.STUDIO),
    RA_OVERVIEW(Mode.RADIOADMIN), RA_PROGRAM(Mode.RADIOADMIN), RA_SCHEDULE(Mode.RADIOADMIN), RA_STATS(Mode.RADIOADMIN), RA_MANAGE(Mode.RADIOADMIN),
}

private data class Tab(val screen: Screen, val label: String, val icon: ImageVector)

private val liveTabs = listOf(
    Tab(Screen.LIVE, "Live", Icons.Filled.Mic),
    Tab(Screen.MUSIC, "Musik", Icons.Filled.LibraryMusic),
    Tab(Screen.SETUP, "Sender", Icons.Filled.Settings),
)
private val studioTabs = listOf(
    Tab(Screen.HOME, "Server", Icons.Filled.Dns),
    Tab(Screen.STUDIO, "Studio", Icons.Filled.SettingsInputAntenna),
    // alle Bereiche wie im Web-Studio und in der Windows-App (Einfach/Profi)
    Tab(Screen.MENU, "Menü", Icons.Filled.Menu),
)
private val adminTabs = listOf(
    Tab(Screen.RA_OVERVIEW, "Übersicht", Icons.Filled.Dashboard),
    Tab(Screen.RA_PROGRAM, "Programm", Icons.Filled.LibraryMusic),
    Tab(Screen.RA_SCHEDULE, "Sendeplan", Icons.Filled.CalendarMonth),
    Tab(Screen.RA_STATS, "Statistik", Icons.Filled.BarChart),
    Tab(Screen.RA_MANAGE, "Verwalten", Icons.Filled.Tune),
)

private fun tabsOf(mode: Mode?): List<Tab> = when (mode) {
    Mode.GOLIVE -> liveTabs
    Mode.STUDIO -> studioTabs
    Mode.RADIOADMIN -> adminTabs
    null -> emptyList()
}

@Composable
fun AppNav() {
    val context = LocalContext.current
    val app = context.applicationContext as AnMaChaCastApp
    val connection by app.connectionRepository.connection.collectAsState()
    val modeStore = remember { ModeStore(context) }
    var lastMode by remember { mutableStateOf(modeStore.get()) }
    var screenName by rememberSaveable { mutableStateOf(Screen.START.name) }
    // geöffnete Seite des Web-Studios als „Titel\nAnsicht\nUnterbereich“ (null = keine; String bleibt speicherbar)
    var webPage by rememberSaveable { mutableStateOf<String?>(null) }
    val screen = Screen.valueOf(screenName)
    val live: GoLiveViewModel = viewModel()
    val admin: RadioadminViewModel = viewModel()
    val liveUi by live.ui.collectAsState()
    val connected = connection != null
    val showLogin = liveUi.lautfm.showLogin
    val mode = screen.mode
    val tabs = tabsOf(mode)

    fun go(s: Screen) {
        webPage = null
        screenName = s.name
    }

    fun open(t: MenuTarget) {
        when (t) {
            MenuTarget.LiveStudio -> go(Screen.STUDIO)
            MenuTarget.Server -> go(Screen.HOME)
            is MenuTarget.Web -> webPage = listOf(t.title, t.view, t.sub).joinToString("\n")
        }
    }

    // Server gewechselt oder getrennt: nichts vom alten Server in der eingebetteten Seite behalten
    LaunchedEffect(connection?.serverUrl, connection?.token) { WebStudio.reset() }

    fun enter(m: Mode) {
        modeStore.set(m)
        lastMode = m
        go(tabsOf(m).first().screen)
    }

    // Zurück: Anmeldung schließen, Unterseite schließen, auf den ersten Reiter, zum Startbildschirm
    BackHandler(enabled = showLogin) { live.closeLautFmLogin() }
    BackHandler(enabled = !showLogin && webPage != null) { webPage = null }
    BackHandler(enabled = !showLogin && webPage == null && screen != Screen.START) {
        if (tabs.isNotEmpty() && screen != tabs.first().screen) go(tabs.first().screen) else go(Screen.START)
    }

    if (showLogin) {
        LautFmLoginScreen(onToken = live::connectLautFm, onClose = live::closeLautFmLogin)
        return
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0),
        topBar = { if (mode != null) ModeHeader(mode, liveUi.running) { enter(it) } },
        bottomBar = {
            val visible = tabs.isNotEmpty() && !(mode == Mode.STUDIO && !connected)
            if (visible) {
                NavigationBar {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = screen == t.screen,
                            onClick = { go(t.screen) },
                            icon = { Icon(t.icon, t.label) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(if (mode == null) Modifier.fillMaxSize() else Modifier.padding(padding).fillMaxSize()) {
            val wp = webPage?.split("\n")
            val conn = connection
            if (wp != null && wp.size == 3 && conn != null) {
                WebStudioScreen(title = wp[0], view = wp[1], sub = wp[2], connection = conn) { webPage = null }
            } else when (screen) {
                Screen.START -> StartScreen(last = lastMode, connectedTo = connection?.serverUrl, onPick = ::enter)
                Screen.LIVE -> LiveScreen(live) { go(Screen.SETUP) }
                Screen.MUSIC -> MusicScreen(live)
                Screen.SETUP -> SetupScreen(live)
                Screen.HOME -> if (!connected) ConnectScreen(onConnected = {}) else {
                    val status: ConnectionStatusViewModel = viewModel()
                    HomeScreen(onOpenStudio = { go(Screen.STUDIO) }, onDisconnect = status::disconnect)
                }
                Screen.STUDIO -> if (connected) StudioScreen() else ConnectScreen(onConnected = {})
                Screen.MENU -> if (connected) MenuScreen(onOpen = ::open) else ConnectScreen(onConnected = {})
                Screen.RA_OVERVIEW -> RaOverviewScreen(admin) { enter(Mode.GOLIVE) }
                Screen.RA_PROGRAM -> RaProgramScreen(admin)
                Screen.RA_SCHEDULE -> RaScheduleScreen(admin)
                Screen.RA_STATS -> RaStatsScreen(admin)
                Screen.RA_MANAGE -> RaManageScreen(admin) { enter(Mode.GOLIVE) }
            }
        }
    }
}
