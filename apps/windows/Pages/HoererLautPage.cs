// KI-Programmchef Teil 4 – Hörer-Funktionen für laut.fm (wie im Web-Studio unter „laut.fm verwalten → KI-Programmchef“):
// Wunschstunde mit Abstimmen und „jederzeit wünschen“, Grüße/Sprachnachrichten auf Sendung, Jingle-Rotation.
// Wünsche, Grüße und Sprachnachrichten kommen über den Hörerbereich; senden lassen sie sich auch im Posteingang
// (Seite „Hörer & Interaktion“). Server: src/server/services/programmchef-hoerer.ts.
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
    sealed class HoererLautPage : View
    {
        static readonly string[] DayNames = { "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So" };
        static readonly string[] AirModes = { "off", "manual", "auto" };
        static readonly int[] PerListener = { 1, 2, 3, 5, 10 };
        static readonly int[] PerArtist = { 0, 1, 2, 3, 5 };
        static readonly int[] JEveryWish = { 0, 3, 4, 5, 6, 8 };
        static readonly int[] JEvery = { 2, 3, 4, 5, 6, 8, 10 };
        static readonly Dictionary<string, string> States = new Dictionary<string, string> { ["open"] = "wartet", ["queued"] = "eingeplant", ["played"] = "gelaufen ✔", ["removed"] = "entfernt" };

        readonly CheckBox enabled = Check("Wunschstunde");
        readonly CheckBox anytime = Check("jederzeit wünschen (läuft gleich, danach wieder raus)");
        readonly CheckBox[] days = DayNames.Select(Check).ToArray();
        readonly ComboBox from = Kit.Combo(Enumerable.Range(0, 24).Select(i => "ab " + i + " Uhr").ToArray());
        readonly ComboBox hours = Kit.Combo("1 Stunde", "2 Stunden", "3 Stunden", "4 Stunden");
        readonly ComboBox perListener = Kit.Combo(PerListener.Select(n => n + " je Hörer und Tag").ToArray());
        readonly ComboBox perArtist = Kit.Combo(PerArtist.Select(n => n == 0 ? "Interpreten nicht begrenzen" : "höchstens " + n + " je Interpret").ToArray());
        readonly TextBox genre = new TextBox { MinWidth = 140, Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 0, 8, 0), ToolTip = "Füllmusik-Genre, wenn zu wenige Wünsche da sind" };
        readonly ComboBox jEveryWish = Kit.Combo(JEveryWish.Select(n => n == 0 ? "keine Jingles" : "Jingle alle " + n + " Songs").ToArray());
        readonly TextBlock wishInfo = Kit.Hint("");
        readonly Table wishes = new Table(("Wunsch", 280), ("von", 90), ("Stimmen", 70), ("Stand", 90));
        readonly ComboBox greet = Kit.Combo("aus", "auf Knopfdruck im Posteingang", "automatisch");
        readonly ComboBox voicemail = Kit.Combo("aus", "auf Knopfdruck im Posteingang", "automatisch");
        readonly ComboBox jMode = Kit.Combo("im Wechsel", "zufällig");
        readonly ComboBox jEvery = Kit.Combo(JEvery.Select(n => "alle " + n + " Songs").ToArray());
        readonly CheckBox jAuto = Check("automatisch");
        readonly ComboBox jHour = Kit.Combo(Enumerable.Range(0, 24).Select(i => "täglich um " + i + " Uhr").ToArray());
        readonly Table jingles = new Table(("Jingle", 220)) { MinHeight = 80 };
        readonly Table playlists = new Table(("in Playlist", 220)) { MinHeight = 80 };
        readonly Table fresh = new Table(("Neu eingegangen", 140), ("Gruß / Sprachnachricht", 280)) { MinHeight = 70 };
        readonly TextBlock liveText = Kit.Hint("");
        readonly Table livePls = new Table(("Live-Playlisten (andere Software)", 260)) { MinHeight = 60 };
        readonly TextBlock jState = Kit.Hint("„Jingles & Playlisten laden“, dann markieren (Strg/Umschalt).");
        JsonElement view;
        bool loadedLists;

        public override string Title => "Wunschstunde & Jingles";

        static CheckBox Check(string text) => new CheckBox { Content = text, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };

        public HoererLautPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var dayWrap = Kit.Wrap(new UIElement[] { enabled }.Concat(days).Concat(new UIElement[] { from, hours }).ToArray());
            Children.Add(Kit.Card("Wunschstunde", Kit.V(dayWrap,
                Kit.Wrap(anytime, perListener, perArtist),
                Kit.Wrap(genre, jEveryWish, Kit.Btn("Speichern", SaveWish, "Playlist „Wunschstunde“ anlegen und im laut.fm-Sendeplan eintragen", true), Kit.Btn("Jetzt aufbauen (Probelauf)", Fill)),
                wishInfo),
                "Hörer wünschen sich Titel aus dem laut.fm-Pool und stimmen ab. Die Playlist „Wunschstunde“ wird 45 Minuten vorher mit den Wünschen (meiste Stimmen zuerst), Füllmusik und Jingles aufgebaut."));
            var mid = new Grid();
            mid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            mid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            mid.Children.Add(Kit.Card("Wünsche", Kit.V(Kit.Wrap(Kit.Btn("Jetzt spielen", QueueNow, "An die gerade laufende Playlist hängen"), Kit.Btn("Entfernen", RemoveWish), Kit.Btn("Neu laden", () => C.Run(Load, "Wünsche"))), wishes)));
            var right = Kit.V(
                Kit.Card("Grüße & Sprachnachrichten auf Sendung", Kit.V(Kit.Wrap(Kit.Text("Grüße:", 13, false, Kit.Fg), greet), Kit.Wrap(Kit.Text("Sprachnachrichten:", 13, false, Kit.Fg), voicemail), liveText, Kit.Wrap(Kit.Btn("Speichern", SaveAir, null, true), Kit.Btn("Markierte auf Sendung", AirSelected, "Automation: laufende laut.fm-Playlist · Live über AnMaCha Cast: als Nächstes in die Warteschlange · Live mit anderer Software: Mediathek (Ordner „Hörer“) + Text zum Vorlesen")), fresh,
                    Kit.Wrap(Kit.Btn("Live-Playlisten speichern", SaveLivePls, "Markierte Playlisten: dort sendest du mit anderer Software live (nach „Jingles & Playlisten laden“)")), livePls),
                    "Grüße formuliert die KI kurz (nur Vorname, ohne Links/Telefonnummern), die Stimme spricht sie; Sprachnachrichten laufen im Original. Danach bei laut.fm automatisch gelöscht."),
                Kit.Card("Jingle-Rotation", Kit.V(Kit.Wrap(jMode, jEvery, jAuto, jHour),
                    Kit.Wrap(Kit.Btn("Jingles & Playlisten laden", LoadLists), Kit.Btn("Speichern", SaveJingles, null, true), Kit.Btn("Jetzt einstreuen", ApplyJingles, "Rückgängig unter „Playlist-Pflege“")),
                    jState, Two(jingles, playlists)),
                    "Eigene Jingles (bei laut.fm als Jingle gekennzeichnet) im Wechsel oder zufällig alle N Songs in die gewählten Playlisten."));
            var sv = new ScrollViewer { Content = right, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(10, 0, 0, 0) };
            Grid.SetColumn(sv, 1);
            mid.Children.Add(sv);
            SetRow(mid, 1);
            Children.Add(mid);
            from.SelectedIndex = 20;
            hours.SelectedIndex = 0;
        }

        static Grid Two(UIElement a, UIElement b)
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.Children.Add(a);
            if (b is FrameworkElement fe) fe.Margin = new Thickness(8, 0, 0, 0);
            Grid.SetColumn(b, 1);
            g.Children.Add(b);
            return g;
        }

        string Ho(string tail = "") => C.St("/programmchef/hoerer" + tail);

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(Load, "Wunschstunde");
        }

        async Task Load()
        {
            view = await C.Api.GetJ(Ho(), 30);
            var w = J.At(view, "wish");
            enabled.IsChecked = J.Bool(w, "enabled");
            anytime.IsChecked = J.Bool(w, "anytime");
            var d = J.Ints(w, "days");
            for (var i = 0; i < 7; i++) days[i].IsChecked = d.Contains(i + 1);
            from.SelectedIndex = (int)J.Long(w, "from", 20);
            hours.SelectedIndex = Math.Max(0, (int)J.Long(w, "hours", 1) - 1);
            perListener.SelectedIndex = Math.Max(0, Array.IndexOf(PerListener, (int)J.Long(w, "perListener", 3)));
            perArtist.SelectedIndex = Math.Max(0, Array.IndexOf(PerArtist, (int)J.Long(w, "perArtist", 2)));
            genre.Text = J.Str(w, "fillGenre");
            jEveryWish.SelectedIndex = Math.Max(0, Array.IndexOf(JEveryWish, (int)J.Long(w, "jingleEvery", 4)));
            var next = J.At(view, "next");
            wishInfo.Text = (!J.Bool(view, "connected") ? "⚠ Zuerst mit laut.fm verbinden. " : "")
                + (J.Ok(next) ? "Nächste Wunschstunde: " + Stamp(J.Long(next, "start")) + " · " + (J.Bool(next, "filled") ? "Playlist ist aufgebaut" : "wird ab " + DateTimeOffset.FromUnixTimeMilliseconds(J.Long(next, "fillAt")).ToLocalTime().ToString("HH:mm") + " Uhr aufgebaut") : "")
                + (J.Str(w, "lastStatus").Length > 0 ? "  ·  Zuletzt: " + J.Str(w, "lastStatus") : "");
            wishes.Set(J.Arr(view, "wishes").Select(x => new Row(x, J.Str(x, "artist") + " – " + J.Str(x, "title"), J.Str(x, "nick", "–"), J.Str(x, "votes"), States.TryGetValue(J.Str(x, "status"), out var s) ? s : J.Str(x, "status"))));
            var air = J.At(view, "air");
            greet.SelectedIndex = Math.Max(0, Array.IndexOf(AirModes, J.Str(air, "greet", "manual")));
            voicemail.SelectedIndex = Math.Max(0, Array.IndexOf(AirModes, J.Str(air, "voicemail", "manual")));
            var jc = J.At(view, "jingles");
            jMode.SelectedIndex = J.Str(jc, "mode") == "random" ? 1 : 0;
            jEvery.SelectedIndex = Math.Max(0, Array.IndexOf(JEvery, (int)J.Long(jc, "every", 4)));
            jAuto.IsChecked = J.Bool(jc, "auto");
            jHour.SelectedIndex = (int)J.Long(jc, "hour", 5);
            var live = await C.Api.GetJ(Ho("/live"), 30);
            var lm = J.Str(live, "mode");
            liveText.Text = (lm == "automation" ? "🟢 Automation: " : "🔴 Live: ") + J.Str(live, "reason")
                + (lm == "automation" ? " – Grüße/Sprachnachrichten kommen in die laufende laut.fm-Playlist." : lm == "cast" ? " – Grüße/Sprachnachrichten kommen als Nächstes in deine Warteschlange." : " – Grüße/Sprachnachrichten landen in der Mediathek (Ordner „Hörer“), Grüße mit Text zum Vorlesen.");
            var inbox = await C.Api.GetJ(C.St("/inbox"), 30);
            fresh.Set(J.Arr(inbox, "items").Where(i => J.Str(i, "status") == "new" && (J.Str(i, "kind") == "message" || J.Str(i, "kind") == "voice")).Take(10)
                .Select(i => new Row(i, (J.Str(i, "kind") == "voice" ? "🎙 " : "💬 ") + J.Str(i, "name", "Hörer"), J.Str(i, "text", J.Str(i, "kind") == "voice" ? "Sprachnachricht" : ""))));
            if (!loadedLists) jState.Text = J.Ints(jc, "ids").Count + " Jingle(s), " + J.Ints(jc, "playlists").Count + " Playlist(en) gewählt" + (J.Str(jc, "lastStatus").Length > 0 ? " · Zuletzt: " + J.Str(jc, "lastStatus") : "") + ". „Jingles & Playlisten laden“ zum Ändern.";
        }

        static string Stamp(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("ddd dd.MM. HH:mm");

        Task SaveWish() => SaveWishWith(false, false);

        Task SaveWishWith(bool adopt, bool replace) => C.Run(async () =>
        {
            var body = new Dictionary<string, object>
            {
                ["enabled"] = enabled.IsChecked == true, ["anytime"] = anytime.IsChecked == true,
                ["days"] = Enumerable.Range(1, 7).Where(i => days[i - 1].IsChecked == true).ToArray(),
                ["from"] = Math.Max(0, from.SelectedIndex), ["hours"] = hours.SelectedIndex + 1,
                ["perListener"] = PerListener[Math.Max(0, perListener.SelectedIndex)], ["perArtist"] = PerArtist[Math.Max(0, perArtist.SelectedIndex)],
                ["fillGenre"] = genre.Text, ["jingleEvery"] = JEveryWish[Math.Max(0, jEveryWish.SelectedIndex)], ["adopt"] = adopt, ["replace"] = replace,
            };
            try { await C.Api.PutJ(Ho("/wish"), body, 60); }
            catch (Api.ApiException ex) when (ex.Code == "adopt_needed" || ex.Code == "conflict")
            {
                if (!Dlg.Confirm(C.Owner, ex.Message + (ex.Code == "conflict" ? "\n\nDiese Stunden mit der Wunschstunde ersetzen?" : "\n\nVorhandene Playlist verwenden?"))) return;
                await SaveWishWith(adopt || ex.Code == "adopt_needed", replace || ex.Code == "conflict");
                return;
            }
            await Load();
            C.Ok(enabled.IsChecked == true ? "Wunschstunde gespeichert und im laut.fm-Sendeplan eingetragen" : anytime.IsChecked == true ? "Wünsche laufen jetzt zwischendurch" : "Wünsche aus");
        }, "Wunschstunde");

        Task Fill() => C.Run(async () =>
        {
            var r = await C.Api.PostJ(Ho("/wish/fill"), null, 600);
            await Load();
            C.Ok(J.Str(r, "status"));
        }, "Wunschstunde");

        Task QueueNow() => C.Run(async () =>
        {
            var w = wishes.One;
            if (w == null) { C.Status("Zuerst einen Wunsch markieren", true); return; }
            await C.Api.PostJ(Ho("/wishes/" + Uri.EscapeDataString(J.Str(w.El, "id")) + "/queue"), null, 60);
            await Load();
            C.Ok("„" + J.Str(w.El, "title") + "“ läuft in Kürze");
        }, "Wunsch");

        Task RemoveWish() => C.Run(async () =>
        {
            foreach (var w in wishes.Many.ToList()) await C.Api.DeleteJ(Ho("/wishes/" + Uri.EscapeDataString(J.Str(w.El, "id"))));
            await Load();
        }, "Wunsch");

        Task SaveAir() => C.Run(async () =>
        {
            await C.Api.PutJ(Ho("/air"), new { greet = AirModes[Math.Max(0, greet.SelectedIndex)], voicemail = AirModes[Math.Max(0, voicemail.SelectedIndex)] });
            C.Ok("Gespeichert");
        }, "Grüße");

        Task AirSelected() => C.Run(async () =>
        {
            var rows = fresh.Many.ToList();
            if (rows.Count == 0) { C.Status("Zuerst Einträge markieren", true); return; }
            var skipped = 0;
            var notes = new List<string>();
            foreach (var r in rows)
            {
                var res = await C.Api.PostJ(C.St("/inbox/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/air"), null, 120);
                if (J.Str(res, "air.skipped").Length > 0) skipped++;
                else if (J.Str(res, "air.mode") != "automation") notes.Add(J.Str(res, "air.title") + (J.Str(res, "air.text").Length > 0 ? ":\n„" + J.Str(res, "air.text") + "“" : ""));
            }
            await Load();
            C.Ok((rows.Count - skipped) + " Beitrag/Beiträge auf Sendung gebracht" + (skipped > 0 ? " – " + skipped + " ungeeignet, nicht gesendet" : ""));
            if (notes.Count > 0) MessageBox.Show(C.Owner, liveText.Text + "\n\n" + string.Join("\n\n", notes), "Live-Sendung – zum Abspielen/Vorlesen");
        }, "Grüße");

        Task LoadLists() => C.Run(async () =>
        {
            var cands = await C.Api.GetJ(Ho("/jingles/candidates"), 60);
            var pf = await C.Api.GetJ(C.St("/programmchef/pflege"), 60);
            var jc = J.At(view, "jingles");
            var ids = J.Ints(jc, "ids");
            var pids = J.Ints(jc, "playlists");
            var jr = J.Arr(cands).Select(t => new Row(t, J.Str(t, "title"))).ToList();
            var pr = J.Arr(pf, "playlists").Select(p => new Row(p, J.Str(p, "title"))).ToList();
            jingles.Set(jr);
            playlists.Set(pr);
            var lp = J.Ints(view, "livePlaylists");
            var lr = J.Arr(pf, "playlists").Select(p => new Row(p, J.Str(p, "title"))).ToList();
            livePls.Set(lr);
            foreach (var r in lr.Where(r => lp.Contains((int)J.Long(r.El, "id")))) livePls.SelectedItems.Add(r);
            foreach (var r in jr.Where(r => ids.Contains((int)J.Long(r.El, "id")))) jingles.SelectedItems.Add(r);
            foreach (var r in pr.Where(r => pids.Contains((int)J.Long(r.El, "id")))) playlists.SelectedItems.Add(r);
            loadedLists = true;
            jState.Text = jr.Count == 0 ? "Bei laut.fm sind keine eigenen Titel als Jingle gekennzeichnet (Art oder Tag „Jingle“)." : "Jingles und Playlisten markieren (Strg/Umschalt), dann „Speichern“.";
        }, "Jingles");

        Task SaveLivePls() => C.Run(async () =>
        {
            if (!loadedLists) { C.Status("Zuerst „Jingles & Playlisten laden“", true); return; }
            await C.Api.PutJ(Ho("/live-playlists"), new { ids = livePls.Many.Select(r => J.Long(r.El, "id")).ToArray() });
            await Load();
            C.Ok("Live-Playlisten gespeichert");
        }, "Live");

        async Task SaveJinglesCore()
        {
            var body = new Dictionary<string, object> { ["mode"] = jMode.SelectedIndex == 1 ? "random" : "rotate", ["every"] = JEvery[Math.Max(0, jEvery.SelectedIndex)], ["auto"] = jAuto.IsChecked == true, ["hour"] = Math.Max(0, jHour.SelectedIndex) };
            if (loadedLists)
            {
                body["ids"] = jingles.Many.Select(r => J.Long(r.El, "id")).ToArray();
                body["playlists"] = playlists.Many.Select(r => J.Long(r.El, "id")).ToArray();
            }
            await C.Api.PutJ(Ho("/jingles"), body);
        }

        Task SaveJingles() => C.Run(async () => { await SaveJinglesCore(); await Load(); C.Ok("Jingle-Rotation gespeichert"); }, "Jingles");

        Task ApplyJingles() => C.Run(async () =>
        {
            await SaveJinglesCore();
            if (!Dlg.Confirm(C.Owner, "Jingles jetzt in die gewählten Playlisten einstreuen? (rückgängig unter „Playlist-Pflege“)")) return;
            var r = await C.Api.PostJ(Ho("/jingles/apply"), null, 900);
            await Load();
            C.Ok(J.Str(r, "summary"));
        }, "Jingles");
    }
}
