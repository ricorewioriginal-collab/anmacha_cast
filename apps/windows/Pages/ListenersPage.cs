// Hörer: Posteingang (Wünsche, Nachrichten, Sprachnachrichten), Umfragen und die Einstellungen des Hörerbereichs.
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class ListenersPage : View
    {
        readonly Table inbox = new Table(("Zeit", 120), ("Art", 90), ("Von", 130), ("Inhalt", 380), ("Status", 70));
        readonly Table polls = new Table(("Frage", 330), ("Optionen", 260), ("Stimmen", 70), ("Aktiv", 60));
        readonly TextBlock unread = Kit.Text("", 13, true);
        readonly CheckBox requests = new CheckBox { Content = "Musikwünsche erlauben", Foreground = Kit.Fg, Margin = new Thickness(3) };
        readonly CheckBox messages = new CheckBox { Content = "Nachrichten erlauben", Foreground = Kit.Fg, Margin = new Thickness(3) };
        readonly CheckBox voting = new CheckBox { Content = "Abstimmungen (Charts) erlauben", Foreground = Kit.Fg, Margin = new Thickness(3) };
        readonly CheckBox voice = new CheckBox { Content = "Sprachnachrichten erlauben", Foreground = Kit.Fg, Margin = new Thickness(3) };

        public override string Title => "Hörer";

        public ListenersPage(Ctx c) : base(c)
        {
            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };

            var inboxTab = new Grid { Margin = new Thickness(8) };
            inboxTab.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            inboxTab.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            inboxTab.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            inboxTab.Children.Add(unread);
            Grid.SetRow(inbox, 1);
            inboxTab.Children.Add(inbox);
            var ib = Kit.Wrap(Kit.Btn("In die Warteschlange", () => Act("queue"), "Gewünschten Titel bzw. die Sprachnachricht einreihen", true), Kit.Btn("Erledigt", () => Act("done")), Kit.Btn("Löschen", () => Act("delete")), Kit.Btn("Neu laden", Load));
            Grid.SetRow(ib, 2);
            inboxTab.Children.Add(ib);
            tabs.Items.Add(new TabItem { Header = "Posteingang", Content = inboxTab });

            var pollTab = new Grid { Margin = new Thickness(8) };
            pollTab.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            pollTab.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            pollTab.Children.Add(polls);
            var pb = Kit.Wrap(Kit.Btn("Neue Umfrage …", NewPoll, null, true), Kit.Btn("Schließen / Öffnen", TogglePoll), Kit.Btn("Löschen", DeletePoll));
            Grid.SetRow(pb, 1);
            pollTab.Children.Add(pb);
            tabs.Items.Add(new TabItem { Header = "Umfragen", Content = pollTab });

            tabs.Items.Add(new TabItem
            {
                Header = "Hörerbereich", Content = new StackPanel
                {
                    Margin = new Thickness(12),
                    Children = { Kit.Hint("Welche Funktionen die öffentliche Senderseite den Hörern anbietet."), requests, messages, voting, voice, Kit.Btn("Speichern", SaveConfig, null, true) },
                },
            });
            Children.Add(tabs);
        }

        public override Task Show() => Load();

        public override void OnEvent(string type) { if ((type == "inbox.changed" || type == "community.changed") && IsVisible) _ = Load(); }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var box = C.Api.GetJ(C.St("/inbox"));
                var pl = C.Api.GetJ(C.St("/polls"));
                await Task.WhenAll(box, pl);
                unread.Text = J.Long(box.Result, "unread") + " ungelesen   ";
                inbox.Set(J.Arr(box.Result, "items").OrderByDescending(i => J.Long(i, "at")).Select(i => new Row(i, Fmt.Stamp(J.Long(i, "at")), Kind(J.Str(i, "kind")), J.Str(i, "name"),
                    J.Str(i, "kind") == "request" ? J.Str(i, "title") + (J.Str(i, "text").Length > 0 ? " – " + J.Str(i, "text") : "") : J.Str(i, "kind") == "voice" ? "(Sprachnachricht)" : J.Str(i, "text"),
                    J.Str(i, "status") == "new" ? "neu" : "erledigt")));
                var cfg = J.Get(box.Result, "config");
                requests.IsChecked = J.Bool(cfg, "requests");
                messages.IsChecked = J.Bool(cfg, "messages");
                voting.IsChecked = J.Bool(cfg, "voting");
                voice.IsChecked = J.Bool(cfg, "voice");
                polls.Set(J.Arr(pl.Result).Select(p => new Row(p, J.Str(p, "question"), string.Join(" · ", J.Strings(p, "options")), J.Str(p, "votes", "0"), J.Bool(p, "active") ? "ja" : "–")));
            }, "Hörer");
        }

        static string Kind(string k) => k == "request" ? "Wunsch" : k == "voice" ? "Sprache" : "Nachricht";

        async Task Act(string action)
        {
            var rows = inbox.Many.ToList();
            if (rows.Count == 0) return;
            if (action == "delete" && !Dlg.Confirm(C.Owner, rows.Count + " Eintrag/Einträge löschen?")) return;
            await C.Run(async () =>
            {
                foreach (var r in rows) await C.Api.PostJ(C.St("/inbox/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/" + action));
                await Load();
                if (action == "queue") C.Ok("Eingereiht");
            }, "Posteingang");
        }

        async Task NewPoll()
        {
            var v = Dlg.Form(C.Owner, "Neue Umfrage", "Anlegen", Field.Text("q", "Frage"), Field.Multi("opts", "Antworten (eine pro Zeile, mindestens 2)"), Field.Check("active", "Sofort aktiv schalten", true));
            if (v == null) return;
            var options = v["opts"].Split('\n').Select(s => s.Trim()).Where(s => s.Length > 0).ToArray();
            if (v["q"].Trim().Length == 0 || options.Length < 2) { C.Status("Bitte eine Frage und mindestens zwei Antworten eingeben", true); return; }
            await C.Run(async () => { await C.Api.PostJ(C.St("/polls"), new { question = v["q"].Trim(), options, active = v["active"] == "true" }); await Load(); }, "Umfrage");
        }

        async Task TogglePoll()
        {
            var r = polls.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/polls/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { active = !J.Bool(r.El, "active") }); await Load(); }, "Umfrage");
        }

        async Task DeletePoll()
        {
            var r = polls.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Umfrage „" + J.Str(r.El, "question") + "“ löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/polls/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); }, "Umfrage");
        }

        Task SaveConfig() => C.Run(async () =>
        {
            await C.Api.PutJ(C.St("/listener"), new { requests = requests.IsChecked == true, messages = messages.IsChecked == true, voting = voting.IsChecked == true, voice = voice.IsChecked == true });
            C.Ok("Gespeichert");
        }, "Hörerbereich");
    }
}
