// KI-Programmchef für laut.fm (wie im Web-Studio unter „laut.fm verwalten → KI-Programmchef“): Wunsch → Plan aus
// Playlisten und Sendezeiten → Titelsuche im laut.fm-Pool (Hintergrundauftrag auf dem Server) → Vorschau → einspielen,
// mit Rückgängig. Dazu der Autopilot, der das Programm nach einer Vorgabe regelmäßig selbst auffrischt.
// Server: src/server/services/programmchef.ts.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class ProgrammchefPage : View
    {
        static readonly Dictionary<string, string> Sources = new Dictionary<string, string>
        {
            ["chart_de"] = "Deutsche Charts", ["chart_global"] = "Weltweite Charts", ["ai"] = "KI-Auswahl", ["pool_genre"] = "laut.fm-Pool (Genre)", ["artists"] = "Interpreten", ["existing"] = "vorhandene Playlist",
        };
        static readonly string[] Days = { "", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So" };

        readonly TextBox wish = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 60, Padding = new Thickness(6) };
        readonly CheckBox single = new CheckBox { Content = "nur eine Playlist (ohne Sendezeiten)", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        readonly TextBlock summary = Kit.Text("", 13, false, Kit.Fg, true);
        readonly TextBlock note = Kit.Hint("");
        readonly Table plan = new Table(("Playlist", 220), ("Quelle", 150), ("Titel", 60), ("Sendezeiten", 200), ("Warum", 360));
        readonly Table found = new Table(("Playlist", 220), ("Gefunden", 80), ("Fehlt", 70), ("Titel", 560));
        readonly TextBlock progress = Kit.Hint("");
        readonly TextBlock undoText = Kit.Hint("");
        readonly TextBox brief = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 50, Padding = new Thickness(6) };
        readonly CheckBox apOn = new CheckBox { Content = "Autopilot an", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        readonly ComboBox every = Kit.Combo("alle 6 Stunden", "alle 12 Stunden", "täglich", "alle 2 Tage", "wöchentlich");
        readonly TextBlock apState = Kit.Hint("");
        static readonly int[] EveryHours = { 6, 12, 24, 48, 168 };
        readonly TextBlock spotState = Kit.Hint("");
        readonly Table spots = new Table(("Beitrag", 170), ("Stand", 220)) { MinHeight = 90 };
        static readonly Dictionary<string, string> SpotStates = new Dictionary<string, string>
        {
            ["producing"] = "wird erzeugt", ["processing"] = "laut.fm verarbeitet", ["queued"] = "eingereiht", ["played"] = "gelaufen ✔", ["expired"] = "verfallen", ["failed"] = "Fehler",
        };
        JsonElement spotCfg;
        JsonElement currentPlan;
        string jobId = "";
        bool jobDone;

        public override string Title => "KI-Programmchef";

        public ProgrammchefPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Children.Add(Kit.Card("Wunsch → Programm", Kit.V(
                wish,
                Kit.Wrap(single, Kit.Btn("Plan erstellen", MakePlan, null, true), Kit.Btn("Titel im laut.fm-Pool suchen", Collect), Kit.Btn("Bei laut.fm einspielen", Apply, "Playlisten anlegen/ergänzen und Sendezeiten eintragen"), Kit.Btn("Rückgängig", Undo), progress),
                undoText),
                "Beschreibe dein Programm, z. B. „Werktags 6–10 Uhr Pop-Hits, abends 18–22 Uhr Rock, je 60 Songs“. Erst wird geplant und gesucht – geändert wird bei laut.fm erst mit „Einspielen“."));
            var mid = new Grid();
            mid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mid.Children.Add(Kit.Card("Plan", Kit.V(summary, note, plan)));
            var f = Kit.Card("Vorschau: im laut.fm-Pool gefunden", found);
            Grid.SetRow(f, 1);
            mid.Children.Add(f);
            SetRow(mid, 1);
            Children.Add(mid);
            var ap = Kit.Card("Autopilot", Kit.V(brief, Kit.Wrap(apOn, every, Kit.Btn("Speichern", SaveAutopilot, null, true), Kit.Btn("Jetzt ausführen", RunAutopilot)), apState),
                "Baut das Programm nach deiner Vorgabe und frischt die Playlisten regelmäßig mit passenden Titeln auf (alte raus, neue rein).");
            var sp = Kit.Card("Moderationen & Sendeuhr", Kit.V(spotState,
                Kit.Wrap(Kit.Btn("Einstellungen …", EditSpots, "Automatik, Takt, Sendezeit, Ansage, Sendeuhr", true),
                    Kit.Btn("Moderation jetzt", () => Produce("moderation")), Kit.Btn("Uhrzeit", () => Produce("uhrzeit")), Kit.Btn("Sender-Ansage", () => Produce("ansage")), Kit.Btn("Nachrichten", () => Produce("nachrichten"))),
                spots),
                "KI-Text → Stimme → privater Titel in der laufenden laut.fm-Playlist; nach dem Abspielen automatisch entfernt.");
            var lower = new Grid();
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            lower.Children.Add(ap);
            sp.Margin = new Thickness(10, 0, 0, 10);
            Grid.SetColumn(sp, 1);
            lower.Children.Add(sp);
            SetRow(lower, 2);
            Children.Add(lower);
            every.SelectedIndex = 2;
        }

        string Pc(string tail = "") => C.St("/programmchef" + tail);

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var s = await C.Api.GetJ(Pc());
                brief.Text = J.Str(s, "autopilot.brief");
                apOn.IsChecked = J.Bool(s, "autopilot.enabled");
                var idx = Array.IndexOf(EveryHours, (int)J.Long(s, "autopilot.everyHours", 24));
                every.SelectedIndex = idx < 0 ? 2 : idx;
                var last = J.Long(s, "autopilot.lastRun");
                apState.Text = last > 0 ? "Letzter Lauf " + DateTimeOffset.FromUnixTimeMilliseconds(last).ToLocalTime().ToString("dd.MM. HH:mm") + ": " + (J.Bool(s, "autopilot.lastOk", true) ? "" : "⚠ ") + J.Str(s, "autopilot.lastResult") : "Noch nicht gelaufen.";
                undoText.Text = J.Ok(J.At(s, "undo")) ? "Zuletzt eingespielt: " + J.Str(s, "undo.summary") : "";
                await LoadSpots();
                if (!J.Bool(s, "ai")) note.Text = "Keine KI eingerichtet – geplant wird nach festen Regeln aus deinem Text (Uhrzeiten, Tage, Anzahl, Charts). Anbieter unter „KI-Studio & Anbieter“.";
            }, "Programmchef");
        }

        static string DayLabel(IEnumerable<int> d)
        {
            var s = d.OrderBy(x => x).ToList();
            if (s.Count == 7) return "täglich";
            if (s.Count >= 3 && s.Last() - s.First() == s.Count - 1) return Days[s.First()] + "–" + Days[s.Last()];
            return string.Join(", ", s.Select(x => Days[x]));
        }

        async Task MakePlan()
        {
            if (wish.Text.Trim().Length == 0) { C.Status("Bitte einen Wunsch eingeben", true); return; }
            progress.Text = "Der Programmchef plant …";
            await C.Run(async () =>
            {
                var r = await C.Api.PostJ(Pc("/plan"), new { wish = wish.Text, single = single.IsChecked == true }, 180);
                currentPlan = J.At(r, "plan");
                jobId = "";
                jobDone = false;
                found.Set(new Row[0]);
                summary.Text = J.Str(currentPlan, "summary");
                note.Text = (J.Str(r, "note").Length > 0 ? "⚠ " + J.Str(r, "note") + "  " : "") + "Geplant von: " + J.Str(r, "model");
                var sched = J.Arr(currentPlan, "schedule").ToList();
                var bas = J.Str(currentPlan, "basePlaylist");
                plan.Set(J.Arr(currentPlan, "playlists").Select(p =>
                {
                    var name = J.Str(p, "name");
                    var times = string.Join("; ", sched.Where(s => J.Str(s, "playlist") == name).Select(s => DayLabel(J.Arr(s, "days").Select(d => (int)d.GetInt64())) + " " + J.Str(s, "from") + "–" + J.Str(s, "to") + " Uhr"));
                    if (name == bas) times = (times.Length > 0 ? times + "; " : "") + "Basis (sonst immer)";
                    var src = J.Str(p, "source");
                    return new Row(p, name, Sources.TryGetValue(src, out var l) ? l : src, src == "existing" ? "–" : J.Str(p, "count"), times, J.Str(p, "why"));
                }));
            }, "Programmchef");
            progress.Text = "";
        }

        async Task Collect()
        {
            if (!J.Ok(currentPlan)) { C.Status("Zuerst „Plan erstellen“", true); return; }
            await C.Run(async () =>
            {
                var job = await C.Api.PostJ(Pc("/collect"), new { plan = currentPlan }, 60);
                jobId = J.Str(job, "id");
                jobDone = false;
                while (J.Str(job, "state") == "running")
                {
                    progress.Text = "Suche Titel … " + J.Str(job, "progress") + " % · " + J.Str(job, "step");
                    await Task.Delay(1500);
                    job = await C.Api.GetJ(Pc("/jobs/" + Uri.EscapeDataString(jobId)), 30);
                }
                progress.Text = "";
                if (J.Str(job, "state") != "done") throw new InvalidOperationException(J.Str(job, "error", "Titelsuche fehlgeschlagen"));
                jobDone = true;
                var results = J.Arr(job, "results").ToList();
                found.Set(results.Select(r => new Row(r, J.Str(r, "name"), J.Arr(r, "found").Count().ToString(), J.Arr(r, "missing").Count().ToString(),
                    J.Str(r, "error").Length > 0 ? "⚠ " + J.Str(r, "error") : string.Join(" · ", J.Arr(r, "found").Take(12).Select(t => J.Str(t, "artist") + " – " + J.Str(t, "title"))))));
                C.Ok(results.Sum(r => J.Arr(r, "found").Count()) + " Titel im laut.fm-Pool gefunden – prüfen und „Bei laut.fm einspielen“");
            }, "Titelsuche");
        }

        async Task Apply()
        {
            if (!jobDone) { C.Status("Zuerst die Titelsuche abschließen", true); return; }
            if (!Dlg.Confirm(C.Owner, "Plan jetzt bei laut.fm einspielen? Playlisten werden angelegt/ergänzt und die Sendezeiten eingetragen (rückgängig machbar).")) return;
            await C.Run(async () =>
            {
                var r = await C.Api.PostJ(Pc("/apply"), new { jobId }, 600);
                undoText.Text = "Zuletzt eingespielt: " + J.Str(r, "summary");
                C.Ok(J.Str(r, "summary") + (J.Bool(r, "schedule") ? " – Sendeplan bei laut.fm geprüft ✔" : ""));
            }, "Einspielen");
        }

        async Task Undo()
        {
            if (!Dlg.Confirm(C.Owner, "Letztes Einspielen zurücknehmen? Neue Playlisten werden gelöscht, hinzugefügte Titel entfernt, der alte Sendeplan wiederhergestellt.")) return;
            await C.Run(async () => { var r = await C.Api.PostJ(Pc("/undo"), null, 600); undoText.Text = ""; C.Ok(J.Str(r, "summary")); }, "Rückgängig");
        }

        async Task LoadSpots()
        {
            var v = await C.Api.GetJ(Pc("/spots"));
            spotCfg = J.At(v, "config");
            spotState.Text = (J.Bool(spotCfg, "enabled") ? "Automatisch an · " + J.Str(spotCfg, "perHour") + "× pro Stunde, " + J.Str(spotCfg, "fromH") + "–" + J.Str(spotCfg, "toH") + " Uhr" : "Automatik aus")
                + (J.Arr(spotCfg, "clock").Any() ? " · Sendeuhr: " + string.Join(", ", J.Arr(spotCfg, "clock").Select(c => ":" + J.Long(c, "minute").ToString("00") + " " + J.Str(c, "kind"))) : "")
                + (J.Bool(v, "voice") ? "" : " · ⚠ keine Stimme eingerichtet");
            spots.Set(J.Arr(v, "spots").Take(15).Select(x => new Row(x, J.Str(x, "title"), (SpotStates.TryGetValue(J.Str(x, "status"), out var l) ? l : J.Str(x, "status")) + (J.Str(x, "error").Length > 0 ? ": " + J.Str(x, "error") : ""))));
        }

        /// <summary>Sendeuhr als Text: „0 nachrichten, 30 uhrzeit“.</summary>
        static List<object> ParseClock(string text)
        {
            var list = new List<object>();
            foreach (var part in text.Split(new[] { ',', ';', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var bits = part.Trim().TrimStart(':').Split(new[] { ' ' }, 2, StringSplitOptions.RemoveEmptyEntries);
                if (bits.Length == 2 && int.TryParse(bits[0], out var m)) list.Add(new { minute = m, kind = bits[1].Trim().ToLowerInvariant() });
            }
            return list;
        }

        Task EditSpots() => C.Run(async () =>
        {
            if (!J.Ok(spotCfg)) await LoadSpots();
            var kinds = J.Strings(spotCfg, "kinds");
            var v = Dlg.Form(C.Owner, "Moderationen & Sendeuhr", "Speichern",
                Field.Check("enabled", "Automatisch erzeugen", J.Bool(spotCfg, "enabled")),
                Field.Choice("perHour", "Moderationen/Ansagen", J.Str(spotCfg, "perHour", "1"), ("0", "nur Sendeuhr"), ("1", "1× pro Stunde"), ("2", "2× pro Stunde"), ("3", "3× pro Stunde"), ("4", "4× pro Stunde")),
                Field.Check("moderation", "Moderationen", kinds.Contains("moderation")), Field.Check("uhrzeit", "Uhrzeit-Ansagen", kinds.Contains("uhrzeit")), Field.Check("ansage", "Sender-Ansagen", kinds.Contains("ansage")),
                Field.Text("fromH", "Von (Uhr)", J.Str(spotCfg, "fromH", "6")), Field.Text("toH", "Bis (Uhr)", J.Str(spotCfg, "toH", "22")),
                Field.Text("ansage", "Sender-Ansage (leer = KI formuliert)", J.Str(spotCfg, "ansage")),
                Field.Text("clock", "Sendeuhr (Minute Art, …)", string.Join(", ", J.Arr(spotCfg, "clock").Select(c => J.Long(c, "minute") + " " + J.Str(c, "kind"))), "z. B. „0 nachrichten, 30 uhrzeit“ – Arten: moderation, uhrzeit, ansage, nachrichten"));
            if (v == null) return;
            var chosen = new[] { "moderation", "uhrzeit", "ansage" }.Where(k => v[k] == "true").ToArray();
            int.TryParse(v["fromH"], out var fromH);
            int.TryParse(v["toH"], out var toH);
            await C.Api.PutJ(Pc("/spots"), new { enabled = v["enabled"] == "true", perHour = int.Parse(v["perHour"]), kinds = chosen, fromH, toH, ansage = v["ansage"], clock = ParseClock(v["clock"]) });
            await LoadSpots();
            C.Ok("Moderationen & Sendeuhr gespeichert");
        }, "Moderationen");

        Task Produce(string kind) => C.Run(async () =>
        {
            await C.Api.PostJ(Pc("/spots/produce"), new { kind });
            C.Ok("Beitrag wird erzeugt und bei laut.fm eingereiht …");
            await LoadSpots();
            for (var i = 0; i < 15 && IsVisible; i++) { await Task.Delay(4000); await LoadSpots(); }
        }, "Beitrag");

        Task SaveAutopilot() => C.Run(async () =>
        {
            await C.Api.PutJ(Pc("/autopilot"), new { enabled = apOn.IsChecked == true, brief = brief.Text, everyHours = EveryHours[Math.Max(0, every.SelectedIndex)] });
            C.Ok(apOn.IsChecked == true ? "Autopilot eingeschaltet – er frischt das Programm regelmäßig auf" : "Autopilot gespeichert (aus)");
        }, "Autopilot");

        Task RunAutopilot() => C.Run(async () =>
        {
            apState.Text = "Autopilot läuft … (kann einige Minuten dauern)";
            var r = await C.Api.PostJ(Pc("/autopilot/run"), null, 900);
            apState.Text = "Letzter Lauf jetzt: " + J.Str(r, "result");
            C.Ok(J.Str(r, "result"));
        }, "Autopilot");
    }
}
