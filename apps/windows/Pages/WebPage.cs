// Bereiche, die das Web-Studio schon vollständig kann (laut.fm verwalten, Jingles, Voice Studio, Nachrichten, Benutzer …),
// erscheinen als ganz normale Seiten im Hauptfenster – kein Zusatzfenster. Alle diese Seiten teilen sich EIN eingebettetes
// WebView2 (spart Speicher): es lädt das Studio einmal im Einbett-Modus (?embed=…, ohne Seitenleiste/Kopfzeile) und wechselt
// danach nur noch die Ansicht über window.anmachaCast. Sender- und Einfach/Profi-Wahl kommen aus der App.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Ui;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AnMaChaCast.Pages
{
    sealed class WebPage : View
    {
        static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast");
        static WebView2 shared;
        static Task<bool> ready;
        static string loadedKey;
        static Uri origin;

        /// <summary>Einrichtungsassistent beim nächsten Öffnen starten (Erststart ohne Einrichtung).</summary>
        public static bool SetupWanted;

        /// <summary>Einfach-/Profi-Modus der App (vom Hauptfenster gesetzt).</summary>
        public static bool Pro = true;

        readonly string title;
        readonly string view;
        readonly string sub;
        readonly Border host = new Border();
        readonly TextBlock info = Kit.Hint("Lädt …");

        public override string Title => title;

        public WebPage(Ctx c, string title, string view, string sub = "") : base(c)
        {
            this.title = title;
            this.view = view;
            this.sub = sub;
            info.HorizontalAlignment = HorizontalAlignment.Center;
            info.VerticalAlignment = VerticalAlignment.Center;
            Children.Add(info);
            Children.Add(host);
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) { host.Child = null; info.Text = "Erst mit einem Server verbinden"; return; }
            if (shared == null) shared = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(5, 10, 20) };
            if (shared.Parent is Border old && old != host) old.Child = null;
            if (host.Child != shared) host.Child = shared;
            if (!await Init()) { host.Child = null; return; }
            var authority = C.Api.Origin.GetLeftPart(UriPartial.Authority);
            var key = authority + "|" + C.Api.Token;
            if (loadedKey != key)
            {
                // erster Aufruf oder anderer Server: Studio im Einbett-Modus laden (Token im Fragment, nicht im Server-Log)
                loadedKey = key;
                Uri.TryCreate(authority, UriKind.Absolute, out origin);
                var url = authority + "/?embed=" + Uri.EscapeDataString(view) + (sub.Length > 0 ? "&sub=" + Uri.EscapeDataString(sub) : "") +
                          "&station=" + Uri.EscapeDataString(C.StationId) + "&mode=" + (Pro ? "pro" : "simple") + (SetupWanted ? "&setup=1" : "") + "#token=" + Uri.EscapeDataString(C.Api.Token);
                SetupWanted = false;
                shared.CoreWebView2.Navigate(url);
                return;
            }
            if (SetupWanted) { SetupWanted = false; await Script("window.anmachaCast && window.anmachaCast.openSetup()"); }
            // Studio noch beim Laden: gewünschte Ansicht vormerken, startEmbedded() übernimmt sie
            await Script("window.anmachaCast ? (window.anmachaCast.setPro(" + (Pro ? "true" : "false") + "), window.anmachaCast.switchStation(" + Js(C.StationId) + "), window.anmachaCast.showView(" + Js(view) + "," + Js(sub) + ")) : (window.__anmachaWant = [" + Js(view) + "," + Js(sub) + "])");
        }

        static string Js(string s) => System.Text.Json.JsonSerializer.Serialize(s ?? "");

        static async Task Script(string js)
        {
            try { await shared.CoreWebView2.ExecuteScriptAsync(js); } catch (Exception ex) when (!(ex is OutOfMemoryException)) { }
        }

        /// <summary>Sender gewechselt: die eingebettete Ansicht zieht nach (ohne neu zu laden).</summary>
        public static void StationChanged(string id)
        {
            if (shared?.CoreWebView2 != null && loadedKey != null) _ = Script("window.anmachaCast && window.anmachaCast.switchStation(" + Js(id) + ")");
        }

        /// <summary>Einfach/Profi gewechselt.</summary>
        public static void ModeChanged(bool pro)
        {
            Pro = pro;
            if (shared?.CoreWebView2 != null && loadedKey != null) _ = Script("window.anmachaCast && window.anmachaCast.setPro(" + (pro ? "true" : "false") + ")");
        }

        async Task<bool> Init()
        {
            if (ready == null) ready = Create();
            var ok = await ready;
            if (!ok)
            {
                ready = null;
                info.Text = "Für diese Seite fehlt die Microsoft-WebView2-Laufzeit (bei Windows 11 vorinstalliert).";
                if (Dlg.Confirm(C.Owner, "Für diese Seite fehlt die Microsoft-WebView2-Laufzeit (bei Windows 11 vorinstalliert).\n\nJetzt herunterladen?"))
                    OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            }
            return ok;
        }

        static async Task<bool> Create()
        {
            try
            {
                Directory.CreateDirectory(LocalDir);
                var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(LocalDir, "WebView2"), options);
                await shared.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException) { return false; }
            var core = shared.CoreWebView2;
            var s = core.Settings;
            s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ANMACHA_CAST_DEVTOOLS") == "1";
            s.IsStatusBarEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            // Mikrofon/Kamera nur für das eigene Studio (Sprachnachrichten, Voice Studio)
            core.PermissionRequested += (o, e) => { if (Own(e.Uri)) e.State = CoreWebView2PermissionState.Allow; };
            core.NavigationStarting += (o, e) =>
            {
                if (Own(e.Uri) || LautFm(e.Uri) || e.Uri.StartsWith("about:", StringComparison.Ordinal)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            core.NewWindowRequested += (o, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.ProcessFailed += (o, e) => { if (e.ProcessFailedKind != CoreWebView2ProcessFailedKind.BrowserProcessExited) core.Reload(); };
            return true;
        }

        static bool Own(string uri) => origin != null && Uri.TryCreate(uri, UriKind.Absolute, out var u)
            && u.Scheme == origin.Scheme && u.Host == origin.Host && u.Port == origin.Port;

        // laut.fm-Anmeldung läuft im eingebetteten Fenster und kehrt mit dem Token zurück
        static bool LautFm(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme == "https"
            && (u.Host == "laut.fm" || u.Host.EndsWith(".laut.fm", StringComparison.OrdinalIgnoreCase));

        static void OpenExternal(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto")) return;
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (Exception ex) when (!(ex is OutOfMemoryException)) { }
        }
    }
}
