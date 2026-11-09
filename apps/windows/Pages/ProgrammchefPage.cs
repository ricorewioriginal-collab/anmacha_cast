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
            SetRow(ap, 2);
            Children.Add(ap);
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
