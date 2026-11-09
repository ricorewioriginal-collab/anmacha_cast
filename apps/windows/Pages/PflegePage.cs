// KI-Programmchef Teil 3 – Playlist-Pflege für laut.fm (wie im Web-Studio unter „laut.fm verwalten → KI-Programmchef“):
// Smart-Mischen (auch automatisch, Jingles bleiben stehen), Aufräumen (Doppelte, Interpreten-Limit, Flops),
// Songliste → Playlist und Sicherung/Wiederherstellung samt Sendeplan; jede Änderung mit „Letzte Pflege rückgängig“.
// Server: src/server/services/programmchef-pflege.ts.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class PflegePage : View
    {
        static readonly string[] Modes = { "off", "laut", "smart" };
        static readonly string[] Cadences = { "h6", "daily", "weekly" };
        static readonly Dictionary<string, string> Kinds = new Dictionary<string, string> { ["dup_id"] = "doppelt", ["dup_song"] = "doppelt", ["overload"] = "Interpret zu oft", ["flop"] = "Flop" };
        static readonly Dictionary<string, string> How = new Dictionary<string, string> { ["titel-interpret"] = "Titel – Interpret", ["interpret-titel"] = "Interpret – Titel", ["ki"] = "KI-korrigiert" };

        readonly ComboBox playlist = new ComboBox { MinWidth = 220, Margin = new Thickness(0, 0, 8, 0) };
        readonly ComboBox mode = Kit.Combo("aus", "laut.fm mischt", "Smart-Mischen");
        readonly ComboBox cadence = Kit.Combo("alle 6 Stunden", "täglich", "wöchentlich");
        readonly ComboBox hour = Kit.Combo(Enumerable.Range(0, 24).Select(i => "um " + i + " Uhr").ToArray());
        readonly ComboBox perArtist = Kit.Combo("höchstens 3 je Interpret", "höchstens 5 je Interpret", "höchstens 8 je Interpret", "Interpreten nicht begrenzen");
        static readonly int[] PerArtist = { 3, 5, 8, 0 };
        readonly TextBlock mixState = Kit.Hint("");
        readonly TextBlock undoText = Kit.Hint("");
        readonly TextBlock tableHint = Kit.Hint("„Vorschau“ zeigt die neue Reihenfolge, „Playlist prüfen“ die Aufräum-Vorschläge – zum Entfernen Zeilen markieren (Strg/Umschalt).");
        readonly Table result = new Table(("Titel", 300), ("Befund", 110), ("Warum", 320));
        readonly TextBox listText = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 90, Padding = new Thickness(6), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        readonly CheckBox useAi = new CheckBox { Content = "Schreibfehler per KI korrigieren", IsChecked = true, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        readonly TextBlock listState = Kit.Hint("Je Zeile ein Song – „Titel - Interpret“ oder „Interpret - Titel“, auch mit Nummern.");
        readonly Table listResult = new Table(("Eingabe", 200), ("Gefunden bei laut.fm", 240), ("erkannt als", 110));
        readonly Table backups = new Table(("Sicherung", 220), ("Datum", 120), ("Inhalt", 240)) { MinHeight = 90 };
        readonly CheckBox autoBackup = new CheckBox { Content = "jede Woche automatisch sichern", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        List<JsonElement> pls = new List<JsonElement>();
        string listName = "";
        string shownKind = "";
        long seed;
        bool loading;

        public override string Title => "Playlist-Pflege";

        public PflegePage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Children.Add(Kit.Card("Playlist-Pflege", Kit.V(
                Kit.Wrap(Kit.Text("Playlist", 13, false, Kit.Fg), playlist, Kit.Text("Automatisch mischen:", 13, false, Kit.Fg), mode, cadence, hour, Kit.Btn("Speichern", SaveMix)),
                mixState,
                Kit.Wrap(Kit.Btn("Vorschau", Preview), Kit.Btn("Jetzt smart mischen", MixNow, "Reihenfolge neu schreiben, gleiche Interpreten auseinander", true), perArtist, Kit.Btn("Playlist prüfen", Scan, "Doppelte, Interpreten über dem Limit und Flops"),
                    Kit.Btn("Markierte entfernen", RemoveSelected), Kit.Btn("Letzte Pflege rückgängig", Undo)),
                undoText),
                "Jingles, Moderationen und Beiträge bleiben beim Mischen und Aufräumen immer an ihrer Stelle; jede Änderung lässt sich zurücknehmen."));
            var mid = new Grid();
            mid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            mid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            mid.Children.Add(Kit.Card("Vorschau / Aufräumen", Kit.V(tableHint, result)));
            var sl = Kit.Card("Songliste → Playlist", Kit.V(listText, Kit.Wrap(useAi, Kit.Btn("Songs suchen", SearchList, null, true), Kit.Btn("Bei laut.fm übernehmen …", ApplyList)), listState, listResult),
                "Jeder Song wird im eigenen Bestand und im laut.fm-Pool gesucht; dann als neue Playlist oder an eine bestehende – in Listen-Reihenfolge.");
            sl.Margin = new Thickness(10, 0, 0, 10);
            Grid.SetColumn(sl, 1);
            mid.Children.Add(sl);
            SetRow(mid, 1);
            Children.Add(mid);
            var bk = Kit.Card("Sicherung", Kit.V(
                Kit.Wrap(Kit.Btn("Jetzt sichern …", Backup, null, true), Kit.Btn("Wiederherstellen …", Restore), Kit.Btn("Als Datei speichern …", Download), Kit.Btn("Datei einspielen …", Import), Kit.Btn("Löschen", DeleteBackup), autoBackup),
                backups),
                "Sichert alle Playlisten (Titel und Reihenfolge) und den Sendeplan; die letzten 5 bleiben erhalten.");
            SetRow(bk, 2);
            Children.Add(bk);
            playlist.SelectionChanged += (s, e) => { if (!loading) SyncMix(); };
            mode.SelectionChanged += (s, e) => cadence.IsEnabled = hour.IsEnabled = mode.SelectedIndex == 2;
            autoBackup.Click += async (s, e) => await C.Run(async () =>
            {
                await C.Api.PutJ(Pf("/backups/auto"), new { enabled = autoBackup.IsChecked == true });
                C.Ok(autoBackup.IsChecked == true ? "Wöchentliche Auto-Sicherung an" : "Auto-Sicherung aus");
            }, "Sicherung");
            perArtist.SelectedIndex = 1;
        }

        string Pf(string tail = "") => C.St("/programmchef/pflege" + tail);
        long Pid => playlist.SelectedIndex >= 0 && playlist.SelectedIndex < pls.Count ? J.Long(pls[playlist.SelectedIndex], "id") : 0;

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(Load, "Playlist-Pflege");
        }

        async Task Load()
        {
            var v = await C.Api.GetJ(Pf(), 60);
            var keep = Pid;
            loading = true;
            pls = J.Arr(v, "playlists").ToList();
            playlist.ItemsSource = pls.Select(p => J.Str(p, "title") + (J.Bool(p, "shuffled") ? " (laut.fm mischt)" : "")).ToList();
            var idx = pls.FindIndex(p => J.Long(p, "id") == keep);
            playlist.SelectedIndex = pls.Count == 0 ? -1 : Math.Max(0, idx);
            loading = false;
            SyncMix();
            undoText.Text = J.Ok(J.At(v, "undo")) ? "Letzte Pflege: " + J.Str(v, "undo.summary") : (J.Str(v, "error").Length > 0 ? "⚠ " + J.Str(v, "error") : "");
            autoBackup.IsChecked = J.Bool(v, "autoBackup");
            useAi.IsEnabled = J.Bool(v, "ai");
            if (!useAi.IsEnabled) useAi.IsChecked = false;
            backups.Set(J.Arr(v, "backups").Select(b => new Row(b, J.Str(b, "label") + (J.Bool(b, "auto") ? " (auto)" : ""),
                DateTimeOffset.FromUnixTimeMilliseconds(J.Long(b, "at")).ToLocalTime().ToString("dd.MM.yy HH:mm"),
                J.Str(b, "playlists") + " Playlisten, " + J.Str(b, "tracks") + " Titel" + (J.Bool(b, "schedule") ? ", Sendeplan" : ""))));
        }

        void SyncMix()
        {
            seed = 0;
            if (Pid == 0) { mixState.Text = "Keine Playlist bei laut.fm."; return; }
            var s = J.At(pls[playlist.SelectedIndex], "shuffle");
            mode.SelectedIndex = Math.Max(0, Array.IndexOf(Modes, J.Str(s, "mode", "off")));
            cadence.SelectedIndex = Math.Max(0, Array.IndexOf(Cadences, J.Str(s, "cadence", "daily")));
            hour.SelectedIndex = (int)J.Long(s, "hour", 4);
            cadence.IsEnabled = hour.IsEnabled = mode.SelectedIndex == 2;
            mixState.Text = J.Str(s, "lastStatus").Length > 0 ? "Zuletzt: " + J.Str(s, "lastStatus") : mode.SelectedIndex == 0 ? "Kein automatisches Mischen." : "";
        }

        Task SaveMix() => C.Run(async () =>
        {
            if (Pid == 0) return;
            var r = await C.Api.PutJ(Pf("/playlists/" + Pid + "/shuffle"), new { mode = Modes[Math.Max(0, mode.SelectedIndex)], cadence = Cadences[Math.Max(0, cadence.SelectedIndex)], hour = Math.Max(0, hour.SelectedIndex) }, 30);
            var m = J.Str(r, "mode");
            await Load();
            C.Ok(m == "off" ? "Automatisches Mischen aus" : m == "laut" ? "laut.fm mischt diese Playlist jetzt selbst" : "Smart-Mischen " + cadence.Text + (J.Str(r, "cadence") == "h6" ? "" : " " + hour.Text));
        }, "Mischen");

        Task Preview() => C.Run(async () =>
        {
            if (Pid == 0) return;
            var r = await C.Api.GetJ(Pf("/playlists/" + Pid + "/shuffle"), 60);
            seed = J.Long(r, "seed");
            shownKind = "preview";
            tableHint.Text = J.Str(r, "count") + " Titel, " + J.Str(r, "fixed") + " Jingles/Beiträge bleiben stehen. Kleinster Abstand gleicher Interpreten: " + J.Str(r, "gapBefore", "–") + " → " + J.Str(r, "gapAfter", "–") + " Songs. „Jetzt smart mischen“ übernimmt genau diese Reihenfolge.";
            var n = 0;
            result.Set(J.Arr(r, "preview").Select(t => new Row(t, (++n) + ". " + J.Str(t, "artist") + " – " + J.Str(t, "title"), J.Bool(t, "fixed") ? "fest" : "", "")));
        }, "Vorschau");

        Task MixNow() => C.Run(async () =>
        {
            if (Pid == 0) return;
            if (!Dlg.Confirm(C.Owner, "„" + J.Str(pls[playlist.SelectedIndex], "title") + "“ jetzt neu mischen? Die Reihenfolge wird bei laut.fm neu geschrieben (rückgängig machbar).")) return;
            C.Ok("Mische … (laut.fm braucht je Titel einen Moment)");
            var r = seed > 0 ? await C.Api.PostJ(Pf("/playlists/" + Pid + "/shuffle"), new { mode = "smart", seed }, 900) : await C.Api.PostJ(Pf("/playlists/" + Pid + "/shuffle"), new { mode = "smart" }, 900);
            await Load();
            C.Status(J.Str(r, "message"), !J.Bool(r, "ok", true));
        }, "Mischen");

        Task Scan() => C.Run(async () =>
        {
            if (Pid == 0) return;
            var r = await C.Api.GetJ(Pf("/playlists/" + Pid + "/cleanup?perArtist=" + PerArtist[Math.Max(0, perArtist.SelectedIndex)] + "&days=3"), 120);
            shownKind = "cleanup";
            var all = J.Arr(r, "duplicates").Concat(J.Arr(r, "overload")).Concat(J.Arr(r, "flops")).ToList();
            tableHint.Text = all.Count == 0
                ? "✔ „" + J.Str(r, "playlist.title") + "“ (" + J.Str(r, "count") + " Titel) ist aufgeräumt – nichts gefunden."
                : J.Str(r, "count") + " Titel geprüft · " + J.Arr(r, "duplicates").Count() + " doppelt · " + J.Arr(r, "overload").Count() + " über dem Limit · " + J.Arr(r, "flops").Count() + " Flops" + (J.Long(r, "statsPlays") > 0 ? " (Ø " + J.Str(r, "avgListeners") + " Hörer)" : " (noch keine Hörerzahlen)") + ". Doppelte sind vorgemerkt – „Markierte entfernen“.";
            var rows = all.Select(f => new Row(f, J.Str(f, "artist") + " – " + J.Str(f, "title"), Kinds.TryGetValue(J.Str(f, "kind"), out var l) ? l : J.Str(f, "kind"), J.Str(f, "reason"))).ToList();
            result.Set(rows);
            foreach (var row in rows.Where(x => J.Str(x.El, "kind").StartsWith("dup"))) result.SelectedItems.Add(row);
        }, "Prüfen");

        Task RemoveSelected() => C.Run(async () =>
        {
            if (shownKind != "cleanup" || Pid == 0) { C.Status("Zuerst „Playlist prüfen“", true); return; }
            var ids = result.Many.Select(r => J.Long(r.El, "id")).Where(x => x > 0).Distinct().ToArray();
            if (ids.Length == 0) { C.Status("Keine Zeilen markiert", true); return; }
            if (!Dlg.Confirm(C.Owner, ids.Length + " Titel aus der Playlist entfernen? Doppelt eingetragene bleiben einmal drin (rückgängig machbar).")) return;
            var r = await C.Api.PostJ(Pf("/playlists/" + Pid + "/cleanup"), new { remove = ids }, 600);
            result.Set(new Row[0]);
            shownKind = "";
            await Load();
            C.Ok(J.Str(r, "summary"));
        }, "Aufräumen");

        Task Undo() => C.Run(async () =>
        {
            if (!Dlg.Confirm(C.Owner, "Letzte Pflege-Änderung zurücknehmen? Reihenfolge und Titel der Playlist(en) werden wie vorher gesetzt.")) return;
            var r = await C.Api.PostJ(Pf("/undo"), null, 900);
            await Load();
            C.Ok(J.Str(r, "summary"));
        }, "Rückgängig");

        Task SearchList() => C.Run(async () =>
        {
            if (listText.Text.Trim().Length == 0) { C.Status("Bitte eine Songliste einfügen", true); return; }
            var job = await C.Api.PostJ(Pf("/songlist"), new { text = listText.Text, ai = useAi.IsChecked == true }, 30);
            var id = J.Str(job, "id");
            while (J.Str(job, "state") == "running")
            {
                listState.Text = "Suche … " + J.Str(job, "progress") + " % · " + J.Str(job, "step");
                await Task.Delay(1500);
                job = await C.Api.GetJ(Pf("/songlist/" + Uri.EscapeDataString(id)), 30);
            }
            if (J.Str(job, "state") != "done") throw new InvalidOperationException(J.Str(job, "error", "Suche fehlgeschlagen"));
            listName = J.Str(job, "name");
            var items = J.Arr(job, "items").ToList();
            var found = items.Where(x => J.Ok(J.At(x, "match"))).ToList();
            listState.Text = found.Count + " von " + items.Count + " Songs bei laut.fm gefunden" + (J.Str(job, "ai") == "used" ? " (Schreibweisen per KI korrigiert)" : "")
                + (items.Count > found.Count ? ". Nicht gefunden: " + string.Join("; ", items.Where(x => !J.Ok(J.At(x, "match"))).Take(20).Select(x => J.Str(x, "raw"))) : ".");
            var rows = found.Select(x => new Row(x, J.Str(x, "raw"), J.Str(x, "match.artist") + " – " + J.Str(x, "match.title"), How.TryGetValue(J.Str(x, "how"), out var l) ? l : "")).ToList();
            listResult.Set(rows);
            listResult.SelectAll();
        }, "Songliste");

        Task ApplyList() => C.Run(async () =>
        {
            var sel = listResult.Many.ToList();
            if (sel.Count == 0) { C.Status("Zuerst „Songs suchen“ und Songs markieren", true); return; }
            // Listen-Reihenfolge, nicht Markier-Reihenfolge
            var order = ((IEnumerable<Row>)listResult.ItemsSource).Where(sel.Contains).Select(r => J.Long(r.El, "match.id")).ToArray();
            var choices = new List<(string, string)> { ("0", "➕ neue Playlist") };
            choices.AddRange(pls.Select(p => (J.Str(p, "id"), J.Str(p, "title"))));
            var v = Dlg.Form(C.Owner, "Songliste übernehmen", "Bei laut.fm übernehmen",
                Field.Choice("target", "Ziel", "0", choices.ToArray()),
                Field.Text("name", "Name der neuen Playlist", listName.Length > 0 ? listName : "Songliste"),
                Field.Check("replace", "Bestehende Playlist genau auf diese Liste setzen (andere Songs raus)", false),
                Field.Info("Titel", order.Length + " Songs in Listen-Reihenfolge"));
            if (v == null) return;
            var target = long.Parse(v["target"]);
            var r = target > 0
                ? await C.Api.PostJ(Pf("/songlist/apply"), new { ids = order, playlistId = target, replace = v["replace"] == "true" }, 900)
                : await C.Api.PostJ(Pf("/songlist/apply"), new { ids = order, name = v["name"] }, 900);
            await Load();
            C.Status(J.Str(r, "summary"), J.Long(r, "failed") > 0);
        }, "Songliste");

        Task Backup() => C.Run(async () =>
        {
            var v = Dlg.Form(C.Owner, "Sicherung anlegen", "Jetzt sichern", Field.Text("label", "Name", "", "z. B. „vor dem Umbau“ – leer = Datum"));
            if (v == null) return;
            C.Ok("Sichere … (je Playlist ein Abruf bei laut.fm)");
            var r = await C.Api.PostJ(Pf("/backups"), new { label = v["label"] }, 900);
            await Load();
            C.Ok(J.Str(r, "summary"));
        }, "Sicherung");

        Task Restore() => C.Run(async () =>
        {
            var b = backups.One;
            if (b == null) { C.Status("Zuerst eine Sicherung markieren", true); return; }
            var v = Dlg.Form(C.Owner, "Sicherung wiederherstellen", "Wiederherstellen",
                Field.Info("Sicherung", J.Str(b.El, "label")),
                Field.Check("exact", "Titel und Reihenfolge genau wie gesichert (sonst nur fehlende ergänzen)", true),
                Field.Check("schedule", "Sendeplan mit wiederherstellen", J.Bool(b.El, "schedule")));
            if (v == null) return;
            C.Ok("Stelle wieder her … (kann einige Minuten dauern)");
            var r = await C.Api.PostJ(Pf("/backups/" + Uri.EscapeDataString(J.Str(b.El, "id")) + "/restore"), new { exact = v["exact"] == "true", schedule = v["schedule"] == "true" }, 1800);
            await Load();
            C.Ok(J.Str(r, "summary"));
        }, "Wiederherstellen");

        Task Download() => C.Run(async () =>
        {
            var b = backups.One;
            if (b == null) { C.Status("Zuerst eine Sicherung markieren", true); return; }
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "laut.fm-sicherung-" + DateTimeOffset.FromUnixTimeMilliseconds(J.Long(b.El, "at")).ToLocalTime().ToString("yyyy-MM-dd") + ".json", Filter = "Sicherung (JSON)|*.json" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var d = await C.Api.GetJ(Pf("/backups/" + Uri.EscapeDataString(J.Str(b.El, "id"))), 60);
            File.WriteAllText(dlg.FileName, d.GetRawText(), new UTF8Encoding(false));
            C.Ok("Sicherung gespeichert: " + dlg.FileName);
        }, "Sicherung");

        Task Import() => C.Run(async () =>
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Title = "Sicherungsdatei einspielen", Filter = "Sicherung (JSON)|*.json|Alle Dateien|*.*" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            using (var doc = JsonDocument.Parse(File.ReadAllText(dlg.FileName)))
            {
                var r = await C.Api.PostJ(Pf("/backups"), new { data = doc.RootElement.Clone() }, 60);
                await Load();
                C.Ok(J.Str(r, "summary") + " – jetzt markieren und „Wiederherstellen …“");
            }
        }, "Sicherung");

        Task DeleteBackup() => C.Run(async () =>
        {
            var b = backups.One;
            if (b == null) { C.Status("Zuerst eine Sicherung markieren", true); return; }
            if (!Dlg.Confirm(C.Owner, "Sicherung „" + J.Str(b.El, "label") + "“ löschen?")) return;
            await C.Api.DeleteJ(Pf("/backups/" + Uri.EscapeDataString(J.Str(b.El, "id"))));
            await Load();
        }, "Sicherung");
    }
}
