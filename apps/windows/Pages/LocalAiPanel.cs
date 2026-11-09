// KI → „Lokale KI auf diesem PC“: ohne Cloud und ohne Key, Modelle immer aktuell von den offiziellen Quellen.
//  • Text: Ollama. Fehlt es auf diesem PC, lädt die App das offizielle Setup (github.com/ollama/ollama, neuestes Release)
//    und startet es. Modelle lädt der Server über Ollama aus der offiziellen Bibliothek (ollama.com/library).
//  • Sprache: Piper (offline). Programm und Stimmen richtet der Server ein (offizielles Release + Stimmenkatalog).
// Was installiert ist, erscheint automatisch als Anbieter. Läuft der Server auf einem anderen Rechner, gilt alles dort.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class LocalAiPanel : ScrollViewer
    {
        // Beliebte Modelle als Vorschlag – geladen wird immer die aktuelle Fassung aus der Ollama-Bibliothek; freie Eingabe möglich
        static readonly string[] Suggested = { "qwen3", "gemma3", "llama3.2", "mistral", "phi4-mini", "deepseek-r1", "granite3.3" };

        readonly Ctx C;
        readonly Func<Task> providersChanged;
        readonly TextBlock ollamaState = Kit.Text("–", 13, true, null, true);
        readonly TextBlock pullState = Kit.Text("", 12, false, Kit.Muted, true);
        readonly ComboBox model = new ComboBox { IsEditable = true, MinWidth = 220, Margin = new Thickness(3) };
        readonly Table models = new Table(("Modell", 260), ("Größe", 90));
        readonly Button installOllama;
        readonly TextBlock piperState = Kit.Text("–", 13, true, null, true);
        readonly ComboBox voice = new ComboBox { MinWidth = 320, Margin = new Thickness(3), DisplayMemberPath = "Item2" };
        readonly Table voices = new Table(("Stimme", 300));
        readonly DispatcherTimer poll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        bool catalogLoaded;
        bool wasBusy;

        public LocalAiPanel(Ctx c, Func<Task> providersChanged)
        {
            C = c;
            this.providersChanged = providersChanged;
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            foreach (var s in Suggested) model.Items.Add(s);
            model.Text = Suggested[0];
            models.MinHeight = 90;
            models.MaxHeight = 200;
            voices.MinHeight = 70;
            voices.MaxHeight = 160;
            installOllama = Kit.Btn("Ollama installieren …", InstallOllama, "Offizielles Setup von github.com/ollama/ollama laden und starten (nur auf diesem PC)", true);

            var text = Kit.Card("Text: Ollama", Kit.V(ollamaState,
                Kit.Wrap(installOllama, Kit.Btn("Neu prüfen", Refresh)),
                Kit.Wrap(Kit.Text("Modell"), model, Kit.Btn("Modell laden", Pull, "Aktuelle Fassung aus der offiziellen Ollama-Bibliothek laden", true), Kit.Btn("Bibliothek ansehen", () => Open("https://ollama.com/library"), "Alle Modelle auf ollama.com")),
                pullState, models, Kit.Wrap(Kit.Btn("Modell entfernen", RemoveModel))),
                "Kostenlos und offline. Kleine Modelle (3–8 GB) laufen auf normalen PCs; Name ohne „:Version“ = immer die aktuelle Fassung.");
            var speech = Kit.Card("Sprache: Piper (offline)", Kit.V(piperState,
                Kit.Wrap(Kit.Text("Stimme"), voice, Kit.Btn("Stimme laden", SetupPiper, "Piper (falls nötig) und die Stimme aus dem offiziellen Katalog laden", true)),
                voices, Kit.Wrap(Kit.Btn("Stimme entfernen", RemoveVoice))),
                "Deutsche Stimmen aus dem offiziellen Piper-Katalog (Hugging Face). Läuft ohne Internet, sobald geladen.");
            Content = Kit.V(text, speech);
            poll.Tick += async (s, e) => { if (IsVisible) await Refresh(); };
        }

        public async Task Show()
        {
            await Refresh();
            if (!catalogLoaded) await LoadCatalog();
        }

        static void Open(string url) { try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) when (!(ex is OutOfMemoryException)) { } }

        async Task Refresh()
        {
            if (!C.Connected) return;
            JsonElement st;
            try { st = await C.Api.GetJ("/ai/local"); }
            catch (ApiException ex) { ollamaState.Text = ex.Status == 403 ? "Lokale KI richtet ein Administrator dieses Servers ein." : ex.Message; poll.Stop(); return; }
            var where = C.IsLocal ? "diesem PC" : "dem Server „" + (C.Server?.Name ?? "") + "“";
            var running = J.Bool(st, "ollama.running");
            ollamaState.Text = running ? "● Ollama " + J.Str(st, "ollama.version") + " läuft auf " + where : "Ollama ist auf " + where + " nicht installiert oder nicht gestartet." +
                (C.IsLocal ? "" : " Auf dem Server: „curl -fsSL https://ollama.com/install.sh | sh“ oder den Docker-Dienst „ollama“ nutzen.");
            ollamaState.Foreground = running ? Kit.Good : Kit.Warn;
            installOllama.Visibility = !running && C.IsLocal ? Visibility.Visible : Visibility.Collapsed;
            var sel = models.One?.Cells[0];
            models.Set(J.Arr(st, "ollama.models").Select(m => new Row(m, J.Str(m, "name"), J.Long(m, "sizeMb") >= 1000 ? (J.Long(m, "sizeMb") / 1000.0).ToString("0.0") + " GB" : J.Long(m, "sizeMb") + " MB")));
            var pulls = J.Arr(st, "pulls").ToList();
            pullState.Text = string.Join("\n", pulls.Select(p => J.Str(p, "model") + ": " + (J.Str(p, "error").Length > 0 ? "Fehler – " + J.Str(p, "error") :
                J.Bool(p, "done") ? "fertig" : J.Long(p, "total") > 0 ? J.Str(p, "status") + " " + (100 * J.Long(p, "completed") / Math.Max(1, J.Long(p, "total"))) + " %" : J.Str(p, "status"))));
            var piperBusy = J.Str(st, "piper.busy");
            var piperErr = J.Str(st, "piper.error");
            var installed = J.Bool(st, "piper.installed");
            piperState.Text = piperBusy.Length > 0 ? "… " + piperBusy : piperErr.Length > 0 ? "Fehler: " + piperErr :
                !J.Bool(st, "piper.supported") ? "Für dieses System gibt es kein fertiges Piper." : installed ? "● Piper ist auf " + where + " eingerichtet" : "Piper ist noch nicht eingerichtet – Stimme wählen und laden.";
            piperState.Foreground = piperErr.Length > 0 ? Kit.Bad : installed ? Kit.Good : Kit.Muted;
            voices.Set(J.Strings(st, "piper.voices").Select(v => new Row(default(JsonElement), v)));
            var busy = piperBusy.Length > 0 || pulls.Any(p => !J.Bool(p, "done"));
            // Fortschritt nur abfragen, solange etwas lädt (spart Last); danach Anbieterliste neu laden
            if (busy) poll.Start(); else poll.Stop();
            if (wasBusy && !busy) await providersChanged();
            wasBusy = busy;
        }

        async Task LoadCatalog()
        {
            try
            {
                var cat = await C.Api.GetJ("/ai/local/piper/voices?lang=de", 40);
                var list = J.Arr(cat).Select(v => Tuple.Create(J.Str(v, "key"), J.Str(v, "name") + " · " + J.Str(v, "quality") + " · " + J.Long(v, "sizeMb") + " MB" + (J.Bool(v, "installed") ? " · geladen" : ""))).ToList();
                voice.ItemsSource = list;
                voice.SelectedItem = list.FirstOrDefault(v => v.Item1 == "de_DE-thorsten-medium") ?? list.FirstOrDefault();
                catalogLoaded = true;
            }
            catch (ApiException ex) { piperState.Text = "Stimmenkatalog: " + ex.Message; }
        }

        Task Pull() => C.Run(async () =>
        {
            var name = (model.Text ?? "").Trim();
            if (name.Length == 0) { C.Status("Bitte einen Modellnamen eingeben, z. B. „qwen3“", true); return; }
            await C.Api.PostJ("/ai/local/ollama/pull", new { model = name });
            C.Ok("Lade „" + name + "“ aus der Ollama-Bibliothek – das kann je nach Größe einige Minuten dauern");
            wasBusy = true;
            await Refresh();
        }, "Modell laden");

        async Task RemoveModel()
        {
            var r = models.One;
            if (r == null) { C.Status("Bitte ein Modell markieren", true); return; }
            if (!Dlg.Confirm(C.Owner, "Modell „" + r.Cells[0] + "“ von " + (C.IsLocal ? "diesem PC" : "dem Server") + " entfernen?")) return;
            await C.Run(async () => { await C.Api.PostJ("/ai/local/ollama/delete", new { model = r.Cells[0] }); await Refresh(); C.Ok("Modell entfernt"); }, "Modell");
        }

        Task SetupPiper() => C.Run(async () =>
        {
            if (!(voice.SelectedItem is Tuple<string, string> v)) { C.Status("Bitte eine Stimme wählen", true); return; }
            await C.Api.PostJ("/ai/local/piper/setup", new { voice = v.Item1 });
            C.Ok("Piper und die Stimme „" + v.Item1 + "“ werden geladen …");
            wasBusy = true;
            await Refresh();
        }, "Piper");

        async Task RemoveVoice()
        {
            var r = voices.One;
            if (r == null) { C.Status("Bitte eine Stimme markieren", true); return; }
            await C.Run(async () => { await C.Api.PostJ("/ai/local/piper/remove", new { voice = r.Cells[0] }); await Refresh(); catalogLoaded = false; await LoadCatalog(); }, "Stimme");
        }

        /// <summary>Offizielles Ollama-Setup (OllamaSetup.exe, neuestes Release auf GitHub) laden und starten.</summary>
        Task InstallOllama() => C.Run(async () =>
        {
            if (!Dlg.Confirm(C.Owner, "Ollama installieren?\n\nOllama ist kostenlos und lässt KI-Modelle offline auf diesem PC laufen. Das offizielle Setup wird von github.com/ollama/ollama geladen (ca. 1 GB) und gestartet.")) return;
            using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) })
            {
                http.DefaultRequestHeaders.UserAgent.ParseAdd("AnMaCha-Cast");
                C.Status("Ollama: suche das offizielle Release …", false);
                var rel = JsonDocument.Parse(await http.GetStringAsync("https://api.github.com/repos/ollama/ollama/releases/latest")).RootElement;
                var asset = J.Arr(rel, "assets").FirstOrDefault(a => J.Str(a, "name") == "OllamaSetup.exe");
                var url = J.Ok(asset) ? J.Str(asset, "browser_download_url") : "";
                if (!url.StartsWith("https://github.com/ollama/ollama/releases/download/", StringComparison.Ordinal)) throw new InvalidOperationException("Im aktuellen Ollama-Release fehlt das Windows-Setup – bitte ollama.com/download öffnen");
                var file = Path.Combine(Path.GetTempPath(), "anmachacast-OllamaSetup.exe");
                C.Status("Ollama: lade Setup " + J.Str(rel, "tag_name") + " (" + J.Long(asset, "size") / 1_000_000 + " MB) …", false);
                using (var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                {
                    res.EnsureSuccessStatusCode();
                    using (var src = await res.Content.ReadAsStreamAsync())
                    using (var dst = File.Create(file)) await src.CopyToAsync(dst);
                }
                var p = Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
                C.Ok("Ollama-Setup gestartet – danach hier „Neu prüfen“ und ein Modell laden");
                if (p != null) await Task.Run(() => p.WaitForExit());
                try { File.Delete(file); } catch (IOException) { }
            }
            await Refresh();
        }, "Ollama");
    }
}
