// Bereiche, die die App (noch) nicht nativ zeigt, kommen vom verbundenen AnMaCha-Cast-Server: das Web-Studio im
// Einbett-Modus (/?embed=<Ansicht>&sub=…&station=…, ohne Seitenleiste/Kopfzeile – wie in der Windows-App). Eine einzige
// WebView für alle diese Seiten (spart Speicher): beim ersten Öffnen wird geladen, danach nur die Ansicht gewechselt
// (window.anmachaCast.showView). Fremde Links gehen in den Browser, Mikrofon/Dateiauswahl nur für den eigenen Server.
package app.anmachacast.studio.common

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import app.anmachacast.studio.data.SavedConnection
import org.json.JSONObject

/** Die gemeinsame WebView (Anwendungs-Kontext, überlebt Bildschirmwechsel). */
@SuppressLint("StaticFieldLeak")
object WebStudio {
    private var view: WebView? = null
    private var loadedKey: String? = null
    private var origin: Uri? = null

    /** Dateiauswahl der Seite (z. B. Mediathek-Upload, Cover) – wird vom Bildschirm bedient. */
    var fileChooser: ((ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean)? = null

    fun own(url: String?): Boolean {
        val u = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val o = origin ?: return false
        return u.scheme == o.scheme && u.host == o.host && u.port == o.port
    }

    private fun lautFm(url: String?): Boolean {
        val u = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val host = u.host ?: return false
        return u.scheme == "https" && (host == "laut.fm" || host.endsWith(".laut.fm"))
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun get(context: Context): WebView {
        view?.let { return it }
        val w = WebView(context.applicationContext)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.mediaPlaybackRequiresUserGesture = false
        w.setBackgroundColor(android.graphics.Color.rgb(5, 10, 20))
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (own(url) || lautFm(url)) return false
                // alles andere (Hilfe-Links, Downloads anderer Seiten, mailto) im Browser bzw. der passenden App
                runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Mikrofon für Sprachnachrichten/Voice Studio nur für den eigenen Server
                if (own(request.origin.toString())) request.grant(request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }.toTypedArray())
                else request.deny()
            }

            override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                val f = fileChooser ?: return false
                return f(callback, params)
            }
        }
        view = w
        return w
    }

    /** Ansicht zeigen: beim ersten Mal (oder nach Server-/Token-Wechsel) laden, sonst nur umschalten. */
    fun show(context: Context, c: SavedConnection, viewName: String, sub: String) {
        val w = get(context)
        val base = c.serverUrl.trimEnd('/')
        val key = base + "|" + c.token
        val station = c.stationIds.firstOrNull { it != "*" } ?: ""
        if (loadedKey != key) {
            loadedKey = key
            origin = Uri.parse(base)
            val url = base + "/?embed=" + Uri.encode(viewName) + (if (sub.isNotEmpty()) "&sub=" + Uri.encode(sub) else "") +
                (if (station.isNotEmpty()) "&station=" + Uri.encode(station) else "") + "&mode=pro#token=" + Uri.encode(c.token)
            w.loadUrl(url)
            return
        }
        val v = JSONObject.quote(viewName)
        val s = JSONObject.quote(sub)
        // Studio lädt noch: Wunsch vormerken, startEmbedded() übernimmt ihn (wie in der Windows-App)
        w.evaluateJavascript("window.anmachaCast ? window.anmachaCast.showView($v,$s) : (window.__anmachaWant = [$v,$s])", null)
    }

    fun reload() { view?.reload() }

    /** Abmelden/Server wechseln: nichts vom alten Server behalten. */
    fun reset() {
        view?.let { it.stopLoading(); it.loadUrl("about:blank"); it.clearHistory() }
        loadedKey = null
        origin = null
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebStudioScreen(title: String, view: String, sub: String, connection: SavedConnection, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var pending by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        pending?.onReceiveValue(uris.toTypedArray())
        pending = null
    }
    DisposableEffect(Unit) {
        WebStudio.fileChooser = { cb, params ->
            pending?.onReceiveValue(null)
            pending = cb
            val type = params.acceptTypes.firstOrNull { it.isNotBlank() }?.split(',')?.firstOrNull()?.trim()?.takeIf { it.contains('/') } ?: "*/*"
            picker.launch(type)
            true
        }
        onDispose { WebStudio.fileChooser = null; pending?.onReceiveValue(null); pending = null }
    }
    LaunchedEffect(view, sub, connection) { WebStudio.show(ctx, connection, view, sub) }
    Scaffold(contentWindowInsets = WindowInsets(0), topBar = {
        TopAppBar(
            windowInsets = WindowInsets(0), title = { Text(title) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück zum Menü") } },
            actions = { IconButton(onClick = { WebStudio.reload() }) { Icon(Icons.Filled.Refresh, "Neu laden") } },
        )
    }) { padding ->
        AndroidView(
            modifier = Modifier.fillMaxSize().padding(padding),
            factory = { c ->
                val w = WebStudio.get(c)
                (w.parent as? ViewGroup)?.removeView(w)
                w
            },
            onRelease = { w -> (w.parent as? ViewGroup)?.removeView(w) },
        )
    }
}
