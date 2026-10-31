// Einstellungen: Automation und Playout (Überblendung, Lautheit, Mikrofon, Encoder …), Smart-Blöcke, Rotation, Nachrichten & Wetter,
// Integrationen und Nextcloud. Der Einstellungs-Editor ändert jeden einzelnen Wert der Server-Konfiguration, auch ohne eigene Maske.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class SettingsPage : View
    {
        static readonly Dictionary<string, string> PlayoutLabels = new Dictionary<string, string>
        {
            ["format"] = "Encoder-Format (mp3/aac/opus)", ["bitrateKbps"] = "Bitrate (kbit/s)", ["crossfadeMs"] = "Überblendung (ms)", ["duckDb"] = "Absenkung bei Sprache (dB)",
            ["silenceThresholdDb"] = "Stille-Schwelle (dB)", ["silenceMs"] = "Stille-Dauer bis Eingriff (ms)", ["fadeInMs"] = "Einblenden (ms)", ["monitor"] = "Mithören am PC",
            ["inputDevice"] = "Eingabegerät (Mikrofon/Line-In)", ["micGainDb"] = "Mikrofon-Verstärkung (dB)", ["mp3Mode"] = "MP3-Modus (cbr/vbr)", ["mp3Quality"] = "MP3-Qualität (VBR 0–9)",
            ["autostart"] = "Playout beim Start automatisch starten", ["loudness.auto"] = "Lautheit angleichen", ["loudness.targetLufs"] = "Ziel-Lautheit (LUFS)",
            ["dsp.compressor"] = "Kompressor", ["dsp.limiter"] = "Limiter", ["dsp.eq"] = "Equalizer-Bänder (dB)",
            ["mic.gate"] = "Mikrofon: Rauschtor (0–100)", ["mic.highpass"] = "Mikrofon: Hochpass", ["mic.eq"] = "Mikrofon: Klang (off/clear/warm/radio)", ["mic.deesser"] = "Mikrofon: De-Esser", ["mic.compressor"] = "Mikrofon: Kompressor (0–100)",
            ["fades.profile"] = "Überblend-Profil", ["fades.stopMs"] = "Ausblenden bei Stopp (ms)", ["fades.skipMs"] = "Ausblenden bei Überspringen (ms)", ["fades.endMs"] = "Ausblenden am Titelende (ms)",
            ["fades.fxMs"] = "Überblendung bei Effekten (ms)", ["fades.shortTrackMs"] = "Kurze Titel bis (ms)", ["fades.curve"] = "Kurvenform (equal/s/linear)",
        };
        static readonly Dictionary<string, string> AutomationLabels = new Dictionary<string, string>
        {
            ["autoFill"] = "Warteschlange automatisch auffüllen", ["rotation"] = "Rotation (Regeln)", ["clock"] = "Sendeuhr", ["inserts"] = "Einschübe",
        };
        static readonly (string, string)[] Orders = { ("random", "zufällig"), ("newest", "neueste zuerst"), ("oldest", "älteste zuerst"), ("alpha", "alphabetisch"), ("popular", "beliebteste zuerst"), ("longest", "längste zuerst"), ("shortest", "kürzeste zuerst") };
        static readonly (string, string)[] Fields = { ("artist", "Interpret"), ("title", "Titel"), ("album", "Album"), ("genre", "Genre"), ("folder", "Ordner"), ("tags", "Tag"), ("year", "Jahr"), ("durationSec", "Dauer (Sek.)"), ("category", "Kategorie"), ("bpm", "BPM") };
        static readonly (string, string)[] Ops = { ("contains", "enthält"), ("notcontains", "enthält nicht"), ("is", "ist"), ("not", "ist nicht"), ("gt", "größer als"), ("lt", "kleiner als"), ("between", "zwischen") };

        readonly ConfigEditor automation;
        readonly ConfigEditor playout;
        readonly ConfigEditor integrations;
        readonly Table blocks = new Table(("Smart-Block", 220), ("Regeln", 80), ("Sortierung", 130), ("Begrenzung", 130));
        readonly Table news = new Table(("Beitrag", 220), ("Stand", 400));
        readonly TextBox nextcloudUrl = Kit.Box("", 360);
        readonly TextBox nextcloudUser = Kit.Box("", 240);
        readonly TextBox nextcloudRoot = Kit.Box("/", 240);
        readonly PasswordBox nextcloudPass = new PasswordBox { Width = 240, Margin = new Thickness(3), Padding = new Thickness(6, 4, 6, 4) };
        readonly TextBox poolText = Kit.Box("", 0);

        public override string Title => "Einstellungen";

        public SettingsPage(Ctx c) : base(c)
        {
            automation = new ConfigEditor(c, "Automation: Auffüllen, Rotation, Sendeuhr, Einschübe. Doppelklick ändert einen Wert; Listen (Regeln, Uhr) bearbeitest du als JSON.", AutomationLabels,
                async () => await C.Api.GetJ(C.St("/automation")), async (key, json) => { await C.Api.PatchJ(C.St("/automation"), RawBody(key, json)); });
            playout = new ConfigEditor(c, "Audio und Playout: Encoder, Überblendung, Lautheit, Mikrofon, Mithören. Änderungen wirken sofort beim nächsten Titel.", PlayoutLabels,
                async () => J.Get(await C.Api.GetJ(C.St("/playout")), "config"), async (key, json) => { await C.Api.PatchJ(C.St("/playout"), RawBody(key, json)); });
            integrations = new ConfigEditor(c, "Webhooks, E-Mail (SMTP) und Benachrichtigungen. Mit „Testen“ prüfst du die Zustellung.", null,
                async () => await C.Api.GetJ(C.St("/integrations")), async (key, json) => { await C.Api.PutJ(C.St("/integrations"), RawBody(key, json)); });

            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };
            tabs.Items.Add(new TabItem { Header = "Automation", Content = Wrap(automation) });
            tabs.Items.Add(new TabItem { Header = "Audio & Playout", Content = Wrap(playout) });
            tabs.Items.Add(new TabItem
            {
                Header = "Smart-Blöcke", Content = ListTab(blocks, "Regelbasierte Titelauswahl (wie bei LibreTime/AzuraCast), z. B. „Rock der 90er, 40 Minuten“.",
                    Kit.Btn("Neuer Block …", () => EditBlock(null), null, true), Kit.Btn("Bearbeiten …", () => EditBlock(blocks.One?.El)), Kit.Btn("Vorschau", Preview),
                    Kit.Btn("Als Playlist speichern", ToPlaylist), Kit.Btn("Löschen", DeleteBlock)),
            });
            var pool = new Grid { Margin = new Thickness(8) };
            pool.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            pool.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            pool.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            pool.Children.Add(Kit.Hint("Rotationspool (JSON): aus welchen Playlists, Ordnern oder Kategorien die Automation Titel zieht. Format wie vom Server geliefert."));
            poolText.AcceptsReturn = true;
            poolText.TextWrapping = TextWrapping.Wrap;
            poolText.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            poolText.FontFamily = new System.Windows.Media.FontFamily("Consolas");
            Grid.SetRow(poolText, 1);
            pool.Children.Add(poolText);
            var pb = Kit.Wrap(Kit.Btn("Speichern", SavePool, null, true), Kit.Btn("Neu laden", LoadPool));
            Grid.SetRow(pb, 2);
            pool.Children.Add(pb);
            tabs.Items.Add(new TabItem { Header = "Rotationspool", Content = pool });
            tabs.Items.Add(new TabItem
            {
                Header = "Nachrichten & Wetter", Content = ListTab(news, "laut.fm erzeugt stündlich Nachrichten und Wetter (zehn Minuten vor der vollen Stunde). Hier abrufen und sofort senden; zeitgesteuert über die Uhr-Ereignisse.",
                    Kit.Btn("⟳ Jetzt abrufen", () => NewsAct("fetch"), null, true), Kit.Btn("📡 Nach dem Titel senden", () => NewsAct("air")), Kit.Btn("Neu laden", () => Show())),
            });
            tabs.Items.Add(new TabItem
            {
                Header = "Integrationen", Content = Wrap(integrations, Kit.Btn("Testen", TestIntegrations)),
            });
            tabs.Items.Add(new TabItem { Header = "Nextcloud", Content = NextcloudTab() });
            Children.Add(tabs);
        }

        static object RawBody(string key, string json)
        {
            using (var doc = JsonDocument.Parse("{\"" + key.Replace("\"", "") + "\":" + json + "}")) return doc.RootElement.Clone();
        }

        static UIElement Wrap(ConfigEditor e, params UIElement[] extra)
        {
            e.Margin = new Thickness(8);
            if (extra.Length == 0) return e;
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.Children.Add(e);
            var b = Kit.Wrap(extra);
            b.Margin = new Thickness(8, 0, 8, 8);
            Grid.SetRow(b, 1);
            g.Children.Add(b);
            return g;
        }

        static UIElement ListTab(Table table, string hint, params UIElement[] buttons)
        {
            var g = new Grid { Margin = new Thickness(8) };
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var h = Kit.Hint(hint);
            h.Margin = new Thickness(0, 0, 0, 6);
            g.Children.Add(h);
            Grid.SetRow(table, 1);
            g.Children.Add(table);
            var b = Kit.Wrap(buttons);
            Grid.SetRow(b, 2);
            g.Children.Add(b);
            return g;
        }

        UIElement NextcloudTab()
        {
            var panel = Kit.V(
                Kit.Hint("Musik und Mitschnitte über deine Nextcloud: Titel importieren, Mitschnitte hochladen. Das Passwort sollte ein App-Passwort sein (Nextcloud → Sicherheit)."),
                Kit.Pair("Server-Adresse", ""), nextcloudUrl, Kit.Pair("Benutzer", ""), nextcloudUser, Kit.Pair("App-Passwort (leer = unverändert)", ""), nextcloudPass, Kit.Pair("Startordner", ""), nextcloudRoot,
                Kit.Wrap(Kit.Btn("Speichern", SaveNextcloud, null, true), Kit.Btn("Ordner anzeigen", ListNextcloud), Kit.Btn("Datei importieren …", ImportNextcloud)));
            panel.Margin = new Thickness(12);
            return panel;
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await automation.Reload();
            await playout.Reload();
            await integrations.Reload();
            await LoadBlocks();
            await LoadPool();
            await LoadNews();
            await LoadNextcloud();
        }

        // ---------- Smart-Blöcke ----------

        async Task LoadBlocks()
        {
            await C.Run(async () =>
            {
                var b = await C.Api.GetJ(C.St("/smart-blocks"));
                var list = J.Ok(J.Get(b, "blocks")) ? J.Arr(b, "blocks") : J.Arr(b);
                blocks.Set(list.Select(x => new Row(x, J.Str(x, "name"), J.Arr(x, "rules").Count().ToString(), Label(Orders, J.Str(x, "order")),
                    J.Str(x, "limit.n") + (J.Str(x, "limit.by") == "minutes" ? " Min." : " Titel"))));
            }, "Smart-Blöcke");
        }

        static string Label((string, string)[] list, string id) => list.FirstOrDefault(x => x.Item1 == id).Item2 ?? id;

        async Task EditBlock(JsonElement? existing)
        {
            var b = existing ?? default;
            var isNew = !J.Ok(b);
            var rules = string.Join("\n", J.Arr(b, "rules").Select(r => J.Str(r, "field") + " " + J.Str(r, "op") + " " + J.Str(r, "value") + (J.Str(r, "value2").Length > 0 ? " | " + J.Str(r, "value2") : "")));
            var v = Dlg.Form(C.Owner, isNew ? "Neuer Smart-Block" : "Smart-Block: " + J.Str(b, "name"), "Speichern",
                Field.Text("name", "Name", J.Str(b, "name")),
                Field.Choice("match", "Regeln verknüpfen", J.Str(b, "match", "all"), ("all", "alle müssen passen"), ("any", "eine genügt")),
                Field.Multi("rules", "Regeln (eine pro Zeile: Feld Vergleich Wert)", rules),
                Field.Info("Felder und Vergleiche", string.Join(", ", Fields.Select(f => f.Item1 + "=" + f.Item2)) + "\n" + string.Join(", ", Ops.Select(o => o.Item1 + "=" + o.Item2)) + "\nBei „between“: Wert | Wert2. Beispiel:  genre is Rock"),
                Field.Choice("order", "Sortierung", J.Str(b, "order", "random"), Orders),
                Field.Choice("by", "Begrenzen nach", J.Str(b, "limit.by", "items"), ("items", "Anzahl Titel"), ("minutes", "Minuten")),
                Field.Text("n", "Begrenzung (0 = unbegrenzt)", J.Str(b, "limit.n", "20")),
                Field.Check("elements", "Auch Jingles, Sweeper und Ansagen einbeziehen", J.Bool(b, "includeElements")));
            if (v == null || v["name"].Trim().Length == 0) return;
            List<object> parsed;
            try { parsed = ParseRules(v["rules"]); } catch (FormatException ex) { C.Status(ex.Message, true); return; }
            var body = new { name = v["name"].Trim(), match = v["match"], rules = parsed, order = v["order"], limit = new { by = v["by"], n = int.TryParse(v["n"], out var n) ? n : 0 }, includeElements = v["elements"] == "true" };
            await C.Run(async () =>
            {
                if (isNew) await C.Api.PostJ(C.St("/smart-blocks"), body); else await C.Api.PatchJ(C.St("/smart-blocks/" + Uri.EscapeDataString(J.Str(b, "id"))), body);
                await LoadBlocks();
            }, "Smart-Block");
        }

        static List<object> ParseRules(string text)
        {
            var list = new List<object>();
            foreach (var raw in (text ?? "").Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                var parts = line.Split(new[] { ' ' }, 3, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 3 || !Fields.Any(f => f.Item1 == parts[0]) || !Ops.Any(o => o.Item1 == parts[1]))
                    throw new FormatException("Regel nicht verständlich: „" + line + "“ – erwartet: Feld Vergleich Wert");
                var vals = parts[2].Split('|');
                if (parts[1] == "between" && vals.Length < 2) throw new FormatException("Bei „between“ bitte zwei Werte mit | trennen: " + line);
                list.Add(vals.Length > 1 ? (object)new { field = parts[0], op = parts[1], value = vals[0].Trim(), value2 = vals[1].Trim() } : new { field = parts[0], op = parts[1], value = vals[0].Trim() });
            }
            return list;
        }

        async Task Preview()
        {
            var r = blocks.One;
            if (r == null) return;
            await C.Run(async () =>
            {
                var p = await C.Api.PostJ(C.St("/smart-blocks/preview"), new { id = J.Str(r.El, "id") });
                var items = J.Arr(p, "items").ToList();
                Dlg.Info(C.Owner, items.Count == 0 ? "Keine passenden Titel." : items.Count + " von " + J.Str(p, "totalMatching") + " passenden Titeln (" + J.Str(p, "minutes") + " Min.):\n\n" + string.Join("\n", items.Take(25).Select(m => (J.Str(m, "artist") + " – " + J.Str(m, "title")).Trim(' ', '–'))) + (items.Count > 25 ? "\n…" : ""), "Vorschau: " + J.Str(r.El, "name"));
            }, "Vorschau");
        }

        async Task ToPlaylist()
        {
            var r = blocks.One;
            if (r == null) return;
            var v = Dlg.Form(C.Owner, "Playlist aus Smart-Block", "Erzeugen", Field.Text("name", "Name der Playlist", J.Str(r.El, "name")),
                Field.Check("snapshot", "Feste Titelliste (Momentaufnahme) statt dynamisch", true));
            if (v == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/smart-blocks/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/playlist"), new { snapshot = v["snapshot"] == "true", name = v["name"] }); C.Ok("Playlist angelegt"); }, "Playlist");
        }

        async Task DeleteBlock()
        {
            var r = blocks.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Smart-Block „" + J.Str(r.El, "name") + "“ löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/smart-blocks/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await LoadBlocks(); }, "Smart-Block");
        }

        // ---------- Rotationspool ----------

        async Task LoadPool() => await C.Run(async () => { var p = await C.Api.GetJ(C.St("/rotation-pool")); poolText.Text = J.Ok(p) ? Pretty(p) : "{}"; }, "Rotationspool");

        static string Pretty(JsonElement e)
        {
            using (var ms = new System.IO.MemoryStream())
            {
                using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = true })) e.WriteTo(w);
                return System.Text.Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        async Task SavePool()
        {
            JsonElement body;
            try { using (var d = JsonDocument.Parse(poolText.Text)) body = d.RootElement.Clone(); }
            catch (JsonException ex) { C.Status("Kein gültiges JSON: " + ex.Message, true); return; }
            await C.Run(async () => { await C.Api.PutJ(C.St("/rotation-pool"), body); C.Ok("Rotationspool gespeichert"); await LoadPool(); }, "Rotationspool");
        }

        // ---------- Nachrichten & Wetter ----------

        static readonly (int, string)[] NewsKinds = { (1, "Nachrichten + Wetter"), (2, "Nachrichten"), (3, "Wetter") };

        async Task LoadNews()
        {
            await C.Run(async () =>
            {
                var n = await C.Api.GetJ(C.St("/news"));
                var credsOk = J.Bool(n, "creds.ok");
                news.Set(NewsKinds.Select(k =>
                {
                    var item = J.Arr(n, "files").FirstOrDefault(x => J.Long(x, "id") == k.Item1);
                    string state;
                    if (!credsOk) state = "Kein laut.fm-Ausgang eingerichtet (Ausgänge & Quellen → laut.fm-Live-Ausgang)";
                    else if (J.Str(item, "err").Length > 0) state = "Fehler: " + J.Str(item, "err");
                    else if (J.Bool(item, "have")) state = "Stand " + Fmt.Stamp(J.Long(item, "t")) + (J.Bool(item, "fresh") ? " · aktuell" : " · veraltet") + " · " + Fmt.Size(J.Long(item, "bytes"));
                    else state = "noch nicht abgerufen";
                    return new Row(item, k.Item2, state);
                }));
            }, "Nachrichten");
        }

        async Task NewsAct(string action)
        {
            var i = news.SelectedIndex;
            if (i < 0) { C.Status("Erst einen Beitrag wählen", true); return; }
            var id = NewsKinds[i].Item1;
            await C.Run(async () =>
            {
                await C.Api.PostJ(C.St("/news/" + id + "/" + action), action == "air" ? (object)new { mode = "track" } : new { }, 90);
                C.Ok(action == "air" ? NewsKinds[i].Item2 + ": läuft nach dem aktuellen Titel" : NewsKinds[i].Item2 + ": aktualisiert");
                await LoadNews();
            }, "Nachrichten");
        }

        // ---------- Integrationen ----------

        Task TestIntegrations() => C.Run(async () => { var r = await C.Api.PostJ(C.St("/integrations/test"), new { }, 60); C.Ok("Test: " + Fmt.Clip(J.Ok(r) ? r.GetRawText() : "gesendet", 160)); }, "Integrationen");

        // ---------- Nextcloud ----------

        async Task LoadNextcloud()
        {
            await C.Run(async () =>
            {
                var n = await C.Api.GetJ("/nextcloud");
                nextcloudUrl.Text = J.Str(n, "url", J.Str(n, "baseUrl"));
                nextcloudUser.Text = J.Str(n, "user");
                nextcloudRoot.Text = J.Str(n, "root", "/");
            }, "Nextcloud");
        }

        async Task SaveNextcloud()
        {
            await C.Run(async () =>
            {
                var body = new Dictionary<string, object> { ["url"] = nextcloudUrl.Text.Trim(), ["user"] = nextcloudUser.Text.Trim(), ["root"] = nextcloudRoot.Text.Trim().Length > 0 ? nextcloudRoot.Text.Trim() : "/" };
                if (nextcloudPass.Password.Length > 0) body["password"] = nextcloudPass.Password;
                await C.Api.PutJ("/nextcloud", body, 40);
                nextcloudPass.Clear();
                C.Ok("Nextcloud gespeichert");
            }, "Nextcloud");
        }

        async Task ListNextcloud()
        {
            var v = Dlg.Form(C.Owner, "Nextcloud-Ordner anzeigen", "Anzeigen", Field.Text("path", "Ordner", "/"));
            if (v == null) return;
            await C.Run(async () =>
            {
                var l = await C.Api.GetJ("/nextcloud/list?path=" + Uri.EscapeDataString(v["path"].Trim().Length > 0 ? v["path"].Trim() : "/"), 40);
                var items = J.Arr(l, "entries").Select(x => (J.Bool(x, "dir") ? "📁 " : J.Bool(x, "audio") ? "🎵 " : "   ") + J.Str(x, "name")).Take(80).ToList();
                Dlg.Info(C.Owner, items.Count == 0 ? "Der Ordner ist leer." : string.Join("\n", items), "Nextcloud: " + J.Str(l, "path", "/"));
            }, "Nextcloud");
        }

        async Task ImportNextcloud()
        {
            var v = Dlg.Form(C.Owner, "Aus Nextcloud importieren", "Importieren",
                Field.Text("path", "Datei oder Ordner in der Nextcloud", "", "z. B. Musik/Titel.mp3 oder Musik (Ordner werden mit Unterordnern übernommen, höchstens 500 Dateien)"),
                Field.Choice("category", "Art der Titel", "music", ("music", "Musik"), ("jingle", "Jingle"), ("sweeper", "Sweeper"), ("news", "Nachrichten"), ("bed", "Musikbett")));
            if (v == null || v["path"].Trim().Length == 0) return;
            await C.Run(async () =>
            {
                C.Status("Importiere aus der Nextcloud …", false);
                var r = await C.Api.PostJ(C.St("/nextcloud/import"), new { paths = new[] { v["path"].Trim() }, category = v["category"] }, 1800);
                C.Ok(J.Str(r, "imported", "0") + " Titel importiert" + (J.Long(r, "skipped") > 0 ? ", " + J.Str(r, "skipped") + " übersprungen" : ""));
            }, "Nextcloud");
        }
    }
}
