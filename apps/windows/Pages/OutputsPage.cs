// Ausgänge & Quellen: wohin gesendet wird (Icecast, SHOUTcast, laut.fm), Zusatz-Streams mit eigenen Profilen und Zeitfenstern,
// woher gesendet wird (Live-Quellen, Relays, Encoder-Eingänge) und Brücken zu anderen Systemen.
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
    sealed class OutputsPage : View
    {
        static readonly (string, string)[] SourceTypes =
        {
            ("live_studio", "Live Studio"), ("remote_studio", "Remote Studio"), ("mobile", "Android/Mobil"), ("automation", "Automation"),
            ("backup_automation", "Backup Automation"), ("emergency", "Emergency"), ("relay", "Relay"), ("url_stream", "URL Stream"),
        };
        static readonly Dictionary<string, string> StateLabels = new Dictionary<string, string>
        {
            ["disconnected"] = "getrennt", ["connecting"] = "verbindet", ["connected"] = "verbunden", ["standby"] = "standby", ["takeover_pending"] = "wartet",
            ["taking_over"] = "übernimmt", ["active"] = "on air", ["blocked"] = "gesperrt", ["failed"] = "ausgefallen", ["fallback"] = "fallback", ["error"] = "Fehler",
        };

        readonly Table outputs = new Table(("Name", 170), ("Art", 80), ("Ziel", 280), ("Zustand", 130), ("On Air seit", 90), ("Hörer", 55));
        readonly Table profiles = new Table(("Profil", 170), ("Format", 70), ("Bitrate", 70), ("Zeitfenster", 200), ("Aktiv", 50));
        readonly Table own = new Table(("Stream", 170), ("Format", 70), ("Bitrate", 70), ("Adresse", 300), ("Aktiv", 50));
        readonly Table sources = new Table(("Priorität", 70), ("Name", 180), ("Art", 130), ("Ziel", 130), ("Zustand", 110), ("Übernahme", 100));
        readonly Table bridges = new Table(("Name", 190), ("Art", 90), ("Adresse", 280), ("Sender/Mount", 130), ("Spiegeln", 70), ("Ziehen", 60));

        public override string Title => "Encoder & Quellen";

        public OutputsPage(Ctx c) : base(c)
        {
            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };
            Button add = null;
            add = Kit.Btn("Neuer Encoder …", () => EncoderDialogs.ShowAddMenu(C, add, true, Load), "laut.fm, weitere laut.fm-Station oder Icecast/SHOUTcast");
            var outMenu = new ContextMenu();
            var outEdit = new MenuItem { Header = "Bearbeiten …" };
            outEdit.Click += async (s, e) => { if (outputs.One != null && await EncoderDialogs.Edit(C, outputs.One.El)) await Load(); };
            outMenu.Items.Add(outEdit);
            EncoderDialogs.AddLautFmLinks(C, outMenu, () => outputs.One?.El);
            outputs.ContextMenu = outMenu;
            tabs.Items.Add(new TabItem
            {
                Header = "Encoder", Content = Tab(outputs, "Hierhin sendet der Server das Programm: Icecast, SHOUTcast oder laut.fm. Verbunden wird nur auf Knopfdruck – nicht schon beim Anlegen.",
                    Kit.Btn("▶ Verbinden", () => SetOutputs(true), "Markierte Encoder verbinden (Strg/Umschalt für mehrere)", true), Kit.Btn("■ Trennen", () => SetOutputs(false), "Markierte Encoder trennen"),
                    Kit.Btn("Alle verbinden", () => SetOutputs(true, true)), Kit.Btn("Alle trennen", () => SetOutputs(false, true)),
                    add, Kit.Btn("Bearbeiten …", async () => { if (outputs.One != null && await EncoderDialogs.Edit(C, outputs.One.El)) await Load(); }),
                    Kit.Btn("Löschen", () => Delete(outputs, "/outputs/")),
                    Kit.Btn("Test der Zusatz-Streams", TestStreams)),
            });
            tabs.Items.Add(new TabItem
            {
                Header = "Zusatz-Streams", Content = Split(
                    Tab(own, "Eigene Streams auf deinem Icecast mit eigener Bitrate und eigenem Link, z. B. für mobile Hörer.",
                        Kit.Btn("Neuer Stream …", () => EditOwn(null), null, true), Kit.Btn("Bearbeiten …", () => EditOwn(own.One?.El)), Kit.Btn("An/Aus", ToggleOwn), Kit.Btn("Löschen", () => Delete(own, "/own-streams/"))),
                    Tab(profiles, "Encoder-Profile (Format, Bitrate, optional nur zu Sendezeiten) für Zusatz-Ausgänge.",
                        Kit.Btn("Neues Profil …", () => EditProfile(null), null, true), Kit.Btn("Bearbeiten …", () => EditProfile(profiles.One?.El)), Kit.Btn("Löschen", () => Delete(profiles, "/stream-profiles/")))),
            });
            tabs.Items.Add(new TabItem
            {
                Header = "Quellen", Content = Tab(sources, "Woher gesendet wird. Kleinere Priorität = wichtiger. Encoder verbinden sich per PUT/SOURCE auf /ingest/<sender>/<mount>, Benutzer = Quellen-ID.",
                    Kit.Btn("Neue Quelle …", () => EditSource(null), null, true), Kit.Btn("Bearbeiten …", () => EditSource(sources.One?.El)), Kit.Btn("Übernehmen", Takeover), Kit.Btn("Freigeben", Release), Kit.Btn("Löschen", () => Delete(sources, "/sources/"))),
            });
            tabs.Items.Add(new TabItem
            {
                Header = "Brücken", Content = Tab(bridges, "Verbindung zu einem bestehenden Icecast, AzuraCast oder Stream: übernimmt den laufenden Titel (Spiegeln) und/oder den Ton (Ziehen als Quelle).",
                    Kit.Btn("Neue Brücke …", () => EditBridge(null), null, true), Kit.Btn("Bearbeiten …", () => EditBridge(bridges.One?.El)), Kit.Btn("Löschen", () => Delete(bridges, "/bridges/"))),
            });
            Children.Add(tabs);
        }

        static UIElement Tab(Table table, string hint, params UIElement[] buttons)
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

        static UIElement Split(UIElement top, UIElement bottom)
        {
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.Children.Add(top);
            Grid.SetRow(bottom, 1);
            g.Children.Add(bottom);
            return g;
        }

        public override Task Show() => Load();

        public override void OnEvent(string type)
        {
            if ((type == "sources.changed" || type == "outputs.changed" || type == "source.state_changed" || type == "output.state_changed") && IsVisible) _ = Load();
        }

        static string State(string s) => StateLabels.TryGetValue(s, out var l) ? l : s;

        /// <summary>Encoder-Zustand wie im Web-Studio: Getrennt → Wartet auf Signal / Verbindet … → ON AIR (oder Fehler).</summary>
        internal static string EncoderState(JsonElement x)
        {
            if (!J.Bool(x, "enabled", true)) return "Getrennt";
            var st = J.Str(x, "state.status");
            if (st == "connected") return "● ON AIR";
            if (st == "connecting") return "Verbindet …";
            if (st == "error") return "Fehler: " + J.Str(x, "state.error");
            return J.Str(x, "failoverFor").Length > 0 ? "Ersatz bereit" : "Wartet auf Signal";
        }

        static string OnAirSince(JsonElement x)
        {
            var at = J.Long(x, "state.connectedAt");
            if (!J.Bool(x, "enabled", true) || J.Str(x, "state.status") != "connected" || at <= 0) return "";
            return DateTimeOffset.FromUnixTimeMilliseconds(at).ToLocalTime().ToString("HH:mm:ss");
        }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var o = C.Api.GetJ(C.St("/outputs"));
                var p = C.Api.GetJ(C.St("/stream-profiles"));
                var s = C.Api.GetJ(C.St("/sources"));
                var b = C.Api.GetJ(C.St("/bridges"));
                var w = C.Api.GetJ(C.St("/own-streams"));
                try { await Task.WhenAll(o, p, s, b, w); } catch (ApiException) { /* einzelne Bereiche können fehlen (Rechte) */ }
                if (o.Status == TaskStatus.RanToCompletion)
                    outputs.Set(J.Arr(o.Result).Select(x => new Row(x, J.Str(x, "name"), J.Str(x, "host").Contains("laut.fm") ? "laut.fm" : J.Str(x, "type"), J.Str(x, "host") + ":" + J.Str(x, "port") + J.Str(x, "mountPath", J.Str(x, "mount")),
                        EncoderState(x), OnAirSince(x), J.Str(x, "state.listeners", ""))));
                if (p.Status == TaskStatus.RanToCompletion)
                    profiles.Set(J.Arr(p.Result).Select(x => new Row(x, J.Str(x, "name"), J.Str(x, "format").ToUpperInvariant(), J.Str(x, "bitrateKbps") + " kbit/s",
                        J.Ok(J.Get(x, "window")) ? Fmt.Days(J.Ints(x, "window.days")) + " " + J.Str(x, "window.from") + "–" + J.Str(x, "window.to") : "immer", J.Bool(x, "enabled", true) ? "✔" : "–")));
                if (s.Status == TaskStatus.RanToCompletion)
                    sources.Set(J.Arr(s.Result).OrderBy(x => J.Long(x, "priority", 99)).Select(x => new Row(x, "P" + J.Str(x, "priority"), J.Str(x, "name"), Type(J.Str(x, "type")), J.Str(x, "target"), State(J.Str(x, "state")), J.Str(x, "takeoverPolicy"))));
                if (b.Status == TaskStatus.RanToCompletion)
                    bridges.Set(J.Arr(b.Result).Select(x => new Row(x, J.Str(x, "name"), J.Str(x, "kind"), J.Str(x, "url"), J.Str(x, "station"), J.Bool(x, "mirror") ? "✔" : "–", J.Bool(x, "pull") ? "✔" : "–")));
                if (w.Status == TaskStatus.RanToCompletion)
                    own.Set(J.Arr(w.Result, "items").Select(x => new Row(x, J.Str(x, "name"), J.Str(x, "format").ToUpperInvariant(), J.Str(x, "bitrateKbps") + " kbit/s", J.Str(x, "url", J.Str(x, "mount")), J.Bool(x, "enabled", true) ? "✔" : "–")));
            }, "Ausgänge");
        }

        static string Type(string id) => SourceTypes.FirstOrDefault(t => t.Item1 == id).Item2 ?? id;

        async Task Delete(Table t, string prefix)
        {
            var rows = t.Many.ToList();
            if (rows.Count == 0 || !Dlg.Confirm(C.Owner, rows.Count + " Eintrag/Einträge löschen?")) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St(prefix + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); }, "Löschen");
        }

        // ---------- Ausgänge ----------

        static int Num(string s, int fallback) => int.TryParse((s ?? "").Trim(), out var n) ? n : fallback;

        /// <summary>Encoder verbinden oder trennen (markierte oder alle).</summary>
        async Task SetOutputs(bool on, bool all = false)
        {
            var rows = (all ? (outputs.ItemsSource as IEnumerable<Row> ?? new Row[0]) : outputs.Many).Where(r => J.Bool(r.El, "enabled", true) != on).ToList();
            if (!all && outputs.One == null) { C.Status("Bitte einen Encoder markieren", true); return; }
            await C.Run(async () =>
            {
                foreach (var r in rows) await C.Api.PatchJ(C.St("/outputs/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { enabled = on });
                await Load();
                C.Ok(on ? rows.Count + " Encoder verbunden – sendet, sobald etwas auf Sendung ist" : rows.Count + " Encoder getrennt");
            }, "Encoder");
        }

        async Task TestStreams()
        {
            await C.Run(async () =>
            {
                C.Status("Teste die Zusatz-Streams (einige Sekunden) …", false);
                var r = await C.Api.PostJ(C.St("/stream-profiles-test"), new { }, 90);
                var lines = J.Arr(r, "outputs").Select(x => (J.Bool(x, "ok") ? "✔ " : "✘ ") + J.Str(x, "name") + " – " + J.Str(x, "bytesDelta") + " Bytes").ToList();
                if (J.Ok(J.Get(r, "hls"))) lines.Add((J.Bool(r, "hls.ok") ? "✔ " : "✘ ") + "HLS");
                Dlg.Info(C.Owner, (J.Bool(r, "ok") ? "Alles empfängt.\n\n" : "Nicht überall Signal.\n\n") + (lines.Count > 0 ? string.Join("\n", lines) : "Keine aktiven Ausgänge konfiguriert."), "Test der Zusatz-Streams");
            }, "Test");
        }

        // ---------- Zusatz-Streams und Profile ----------

        async Task EditOwn(JsonElement? existing)
        {
            var o = existing ?? default;
            var isNew = !J.Ok(o);
            var fields = new List<Field> { Field.Text("name", "Name", J.Str(o, "name"), "Daraus entsteht der Mountpoint, z. B. „Mobil“ → /mobil") };
            if (isNew) fields.Add(Field.Choice("format", "Format", "mp3", ("mp3", "MP3 (überall abspielbar)"), ("aac", "AAC (effizient bei niedriger Bitrate)"), ("opus", "Opus (sehr effizient)")));
            fields.Add(Field.Text("bitrate", "Bitrate (kbit/s, 32 bis 320)", J.Str(o, "bitrateKbps", "64"), "48–64 für mobile Hörer, 128 Standard, 192+ HiFi"));
            var v = Dlg.Form(C.Owner, isNew ? "Neuer eigener Stream" : "Eigener Stream: " + J.Str(o, "name"), isNew ? "Anlegen" : "Speichern", fields.ToArray());
            if (v == null || v["name"].Trim().Length == 0) return;
            await C.Run(async () =>
            {
                if (isNew) await C.Api.PostJ(C.St("/own-streams"), new { name = v["name"].Trim(), format = v["format"], bitrateKbps = Num(v["bitrate"], 64) });
                else await C.Api.PatchJ(C.St("/own-streams/" + Uri.EscapeDataString(J.Str(o, "id"))), new { name = v["name"].Trim(), bitrateKbps = Num(v["bitrate"], 64) });
                await Load();
            }, "Zusatz-Stream");
        }

        async Task ToggleOwn()
        {
            var r = own.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/own-streams/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { enabled = !J.Bool(r.El, "enabled", true) }); await Load(); }, "Zusatz-Stream");
        }

        async Task EditProfile(JsonElement? existing)
        {
            var o = existing ?? default;
            var isNew = !J.Ok(o);
            var v = Dlg.Form(C.Owner, isNew ? "Profil anlegen" : "Profil: " + J.Str(o, "name"), "Speichern",
                Field.Text("name", "Name", J.Str(o, "name", "Mobile AAC")), Field.Choice("format", "Format", J.Str(o, "format", "aac"), ("mp3", "MP3"), ("aac", "AAC"), ("opus", "Opus")),
                Field.Text("bitrate", "Bitrate (kbit/s)", J.Str(o, "bitrateKbps", "64")), Field.Check("enabled", "Encoder aktiv", J.Bool(o, "enabled", true)),
                Field.Check("windowOn", "Nur zu bestimmten Sendezeiten", J.Ok(J.Get(o, "window"))),
                Field.Text("days", "Zeitfenster: Tage (Mo,Di,… – leer = täglich)", Fmt.Days(J.Ints(o, "window.days")) == "täglich" ? "" : Fmt.Days(J.Ints(o, "window.days"))),
                Field.Text("from", "Zeitfenster: Von (HH:MM)", J.Str(o, "window.from", "20:00")), Field.Text("to", "Zeitfenster: Bis (HH:MM)", J.Str(o, "window.to", "22:00")));
            if (v == null) return;
            if (v["windowOn"] == "true" && (!Fmt.ValidTime(v["from"].Trim()) || !Fmt.ValidTime(v["to"].Trim()))) { C.Status("Uhrzeiten bitte als HH:MM", true); return; }
            object window = v["windowOn"] == "true" ? (object)new { label = v["name"], days = Fmt.ParseDays(v["days"]), from = v["from"].Trim(), to = v["to"].Trim() } : null;
            var body = new { name = v["name"], format = v["format"], bitrateKbps = Num(v["bitrate"], 64), enabled = v["enabled"] == "true", window };
            await C.Run(async () =>
            {
                if (isNew) await C.Api.PostJ(C.St("/stream-profiles"), body); else await C.Api.PatchJ(C.St("/stream-profiles/" + Uri.EscapeDataString(J.Str(o, "id"))), body);
                await Load();
            }, "Profil");
        }

        // ---------- Quellen ----------

        async Task EditSource(JsonElement? existing)
        {
            var s = existing ?? default;
            var isNew = !J.Ok(s);
            var fields = new List<Field>
            {
                Field.Text("name", "Name", J.Str(s, "name")), Field.Choice("type", "Art", J.Str(s, "type", "remote_studio"), SourceTypes),
                Field.Text("priority", "Priorität (1 = höchste)", J.Str(s, "priority", "5")), Field.Text("target", "Ziel / Mountpoint", J.Str(s, "target", "/live")),
                Field.Choice("policy", "Übernahme", J.Str(s, "takeoverPolicy", "auto"), ("auto", "automatisch"), ("manual", "nur manuell"), ("never", "nie")),
                Field.Password("password", "Encoder-Passwort (neu setzen)", "Mindestens 8 Zeichen. Encoder: PUT/SOURCE auf /ingest/<sender>/<mount>, Benutzer = Quellen-ID"),
            };
            if (!isNew) fields.Add(Field.Check("blocked", "Gesperrt", J.Bool(s, "blocked")));
            var v = Dlg.Form(C.Owner, isNew ? "Quelle anlegen" : "Quelle: " + J.Str(s, "name"), "Speichern", fields.ToArray());
            if (v == null || v["name"].Trim().Length == 0) return;
            var body = new Dictionary<string, object> { ["name"] = v["name"].Trim(), ["type"] = v["type"], ["priority"] = Num(v["priority"], 5), ["target"] = v["target"].Trim(), ["takeoverPolicy"] = v["policy"] };
            if (!isNew) body["blocked"] = v["blocked"] == "true";
            await C.Run(async () =>
            {
                var saved = isNew ? await C.Api.PostJ(C.St("/sources"), body) : await C.Api.PatchJ(C.St("/sources/" + Uri.EscapeDataString(J.Str(s, "id"))), body);
                if (v["password"].Length > 0) await C.Api.PostJ(C.St("/sources/" + Uri.EscapeDataString(J.Str(saved, "id", J.Str(s, "id"))) + "/password"), new { password = v["password"] });
                C.Ok("Quelle gespeichert. Encoder-Benutzer: " + J.Str(saved, "id", J.Str(s, "id")));
                await Load();
            }, "Quelle");
        }

        async Task Takeover()
        {
            var r = sources.One;
            if (r == null) return;
            var path = C.St("/sources/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/takeover");
            try { await C.Api.PostJ(path, new { }); await Load(); C.Ok("Übernommen"); }
            catch (ApiException ex) when (ex.Status == 409 || ex.Status == 403)
            {
                if (Dlg.Confirm(C.Owner, ex.Message + "\n\nAls Operator-Override erzwingen?"))
                    await C.Run(async () => { await C.Api.PostJ(path, new { force = true }); await Load(); }, "Übernahme");
            }
            catch (ApiException ex) { C.Status("Übernahme: " + ex.Message, true); }
        }

        async Task Release()
        {
            var r = sources.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/sources/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/release")); await Load(); }, "Quelle");
        }

        // ---------- Brücken ----------

        async Task EditBridge(JsonElement? existing)
        {
            var b = existing ?? default;
            var isNew = !J.Ok(b);
            var v = Dlg.Form(C.Owner, isNew ? "Brücke anlegen" : "Brücke: " + J.Str(b, "name"), "Speichern",
                Field.Text("name", "Name", J.Str(b, "name")),
                Field.Choice("kind", "Art", J.Str(b, "kind", "icecast"), ("icecast", "Icecast"), ("azuracast", "AzuraCast"), ("stream", "Stream-Adresse")),
                Field.Text("url", "Adresse des Servers (http/https)", J.Str(b, "url")),
                Field.Text("station", "AzuraCast: Kurzname oder ID · Icecast: Mountpoint", J.Str(b, "station")),
                Field.Text("pullUrl", "Stream-Adresse zum Mithören (nur Art „Stream“)", J.Str(b, "pullUrl")),
                Field.Check("mirror", "Laufenden Titel spiegeln", J.Bool(b, "mirror", true)), Field.Check("pull", "Ton als Quelle ziehen", J.Bool(b, "pull")),
                Field.Text("priority", "Priorität der Quelle (kleiner = wichtiger)", J.Str(b, "priority", "20")),
                Field.Password("apiKey", "API-Schlüssel (leer = unverändert)"));
            if (v == null || v["name"].Trim().Length == 0) return;
            var body = new Dictionary<string, object>
            {
                ["name"] = v["name"].Trim(), ["kind"] = v["kind"], ["url"] = v["url"].Trim(), ["station"] = v["station"].Trim(), ["pullUrl"] = v["pullUrl"].Trim(),
                ["mirror"] = v["mirror"] == "true", ["pull"] = v["pull"] == "true", ["priority"] = Num(v["priority"], 20),
            };
            if (v["apiKey"].Length > 0) body["apiKey"] = v["apiKey"];
            await C.Run(async () =>
            {
                if (isNew) await C.Api.PostJ(C.St("/bridges"), body); else await C.Api.PatchJ(C.St("/bridges/" + Uri.EscapeDataString(J.Str(b, "id"))), body);
                await Load();
            }, "Brücke");
        }
    }
}
