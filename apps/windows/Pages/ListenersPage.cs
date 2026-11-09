// Hörer: Posteingang (Wünsche, Nachrichten, Sprachnachrichten, Studiomail), Antworten per Mail, Umfragen, Einstellungen
// des Hörerbereichs und die Studiomail (eigenes Postfach per IMAP/SMTP).
using System;
using System.Collections.Generic;
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
        readonly Table inbox = new Table(("Zeit", 120), ("Art", 90), ("Von", 170), ("Inhalt", 380), ("Status", 80));
        readonly TextBlock mailState = Kit.Hint("");
        static readonly string[] WidgetKinds = { "requests", "messages", "voice", "voting", "polls", "forms", "hoerer", "player" };
        readonly ComboBox wKind = Kit.Combo("Wunschbox (Musikwunsch + Wunschliste)", "Grüße & Nachrichten", "Sprachnachricht ans Studio", "Song-Voting & Hörer-Charts", "Umfrage", "Formular", "Hörerbereich komplett", "Player (Jetzt läuft)");
        readonly ComboBox wTheme = Kit.Combo("dunkel", "hell");
        readonly TextBox wPublic = new TextBox { MinWidth = 280, Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 0, 8, 0), ToolTip = "z. B. https://radio.meine-seite.de" };
        readonly TextBox wUrl = Ro(), wScript = Ro(), wIframe = Ro();
        readonly TextBlock wHint = Kit.Hint("");
        static TextBox Ro() => new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, Padding = new Thickness(6), Margin = new Thickness(0, 2, 0, 6), MaxWidth = 900, HorizontalAlignment = HorizontalAlignment.Left };
        System.Text.Json.JsonElement mail;
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
            var ib = Kit.Wrap(Kit.Btn("In die Warteschlange", () => Act("queue"), "Gewünschten Titel bzw. die Sprachnachricht einreihen", true), Kit.Btn("Auf Sendung", () => Act("air"), "Gruß (KI formuliert, Stimme spricht) oder Sprachnachricht: bei laut.fm-Automation in die laufende Playlist, bei Live über AnMaCha Cast als Nächstes in die Warteschlange, bei Live mit anderer Software in die Mediathek"), Kit.Btn("Antworten …", Reply, "Per Studiomail an die Adresse des Hörers antworten"), Kit.Btn("Erledigt", () => Act("done")), Kit.Btn("Löschen", () => Act("delete")), Kit.Btn("Neu laden", Load));
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
            tabs.Items.Add(new TabItem
            {
                Header = "Widgets & Website", Content = new ScrollViewer
                {
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    Content = new StackPanel
                    {
                        Margin = new Thickness(12),
                        Children =
                        {
                            Kit.Hint("Wunschbox, Grüße, Sprachnachricht, Voting, Umfrage, Formular oder Player für deine eigene Website – über deinen AnMaCha-Cast-Server oder als Datei auf deinem eigenen Webspace."),
                            Kit.Wrap(wKind, wTheme),
                            Kit.Wrap(Kit.Text("Öffentliche Adresse deines AnMaCha-Cast-Servers:", 13, false, Kit.Fg), wPublic, Kit.Btn("Speichern", SavePublic)),
                            wHint,
                            Kit.Text("1 · Direkte Adresse (auf deinem AnMaCha-Cast-Server)", 13, true), wUrl,
                            Kit.Wrap(Kit.Btn("Kopieren", () => Copy(wUrl.Text, "Adresse")), Kit.Btn("Öffnen", () => Open(wUrl.Text))),
                            Kit.Text("2 · In deine Website einbetten", 13, true), wScript, Kit.Btn("Skript-Code kopieren", () => Copy(wScript.Text, "Skript-Code")), wIframe, Kit.Btn("iframe-Code kopieren", () => Copy(wIframe.Text, "iframe-Code")),
                            Kit.Text("3 · Als Datei auf deinen eigenen Webspace", 13, true),
                            Kit.Hint("Eine einzelne HTML-Datei (Seite und Skript in einer Datei) – hochladen, fertig. Die Daten kommen von der öffentlichen Adresse deines Servers."),
                            Kit.Btn("Datei speichern …", SaveWidgetFile, null, true),
                        },
                    },
                },
            });
            tabs.Items.Add(new TabItem
            {
                Header = "Studiomail", Content = new StackPanel
                {
                    Margin = new Thickness(12),
                    Children =
                    {
                        Kit.Hint("Eigenes Postfach verbinden (IMAP/SMTP): neue Mails an die Studio-Adresse landen im Posteingang (Audio-Anhang = Sprachnachricht), Antworten gehen von hier per Mail raus. Übernommen wird nur Post ab dem Verbinden."),
                        mailState,
                        Kit.Wrap(Kit.Btn("Postfach einrichten …", MailSettings, null, true), Kit.Btn("Jetzt abholen", CheckMail)),
                    },
                },
            });
            Children.Add(tabs);
            wKind.SelectedIndex = 0;
            wTheme.SelectedIndex = 0;
            wKind.SelectionChanged += async (s, e) => await LoadWidget();
            wTheme.SelectionChanged += async (s, e) => await LoadWidget();
        }

        string WidgetQuery() => "kind=" + WidgetKinds[Math.Max(0, wKind.SelectedIndex)] + (wTheme.SelectedIndex == 1 ? "&theme=light" : "");

        Task LoadWidget() => C.Run(async () =>
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            var w = await C.Api.GetJ(C.St("/widgets?" + WidgetQuery()));
            if (!wPublic.IsKeyboardFocused) wPublic.Text = J.Str(w, "publicUrl");
            wUrl.Text = J.Str(w, "url");
            wScript.Text = J.Str(w, "script");
            wIframe.Text = J.Str(w, "iframe");
            wHint.Text = J.Str(w, "publicUrl").Length == 0 ? "Ohne öffentliche Adresse gilt " + J.Str(w, "origin") + " – das funktioniert nur, wenn Hörer deinen Server so erreichen. Für Datei und Einbettung die Adresse eintragen, unter der der Server im Internet erreichbar ist." : "";
        }, "Widgets");

        void Copy(string text, string what) { if (text.Length == 0) return; Clipboard.SetText(text); C.Ok(what + " kopiert"); }

        void Open(string url) { if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }

        Task SavePublic() => C.Run(async () =>
        {
            await C.Api.PutJ(C.St("/listener"), new { publicUrl = wPublic.Text.Trim() });
            await LoadWidget();
            C.Ok(wPublic.Text.Trim().Length > 0 ? "Öffentliche Adresse gespeichert" : "Öffentliche Adresse entfernt");
        }, "Widgets");

        Task SaveWidgetFile() => C.Run(async () =>
        {
            var kind = WidgetKinds[Math.Max(0, wKind.SelectedIndex)];
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "anmacha-cast-" + kind + ".html", Filter = "Webseite (HTML)|*.html" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var bytes = await C.Api.Download(C.St("/widgets/file?" + WidgetQuery()));
            System.IO.File.WriteAllBytes(dlg.FileName, bytes);
            C.Ok("Gespeichert: " + dlg.FileName + " – auf deinen Webspace hochladen");
        }, "Widgets");

        public override Task Show() => Load();

        public override void OnEvent(string type) { if ((type == "inbox.changed" || type == "community.changed") && IsVisible) _ = Load(); }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var box = C.Api.GetJ(C.St("/inbox"));
                var pl = C.Api.GetJ(C.St("/polls"));
                var ml = C.Api.GetJ(C.St("/studiomail"));
                await Task.WhenAll(box, pl, ml);
                mail = ml.Result;
                _ = LoadWidget();
                mailState.Text = J.Bool(mail, "enabled") ? "✉ " + J.Str(mail, "address") + " – verbunden" + (J.Long(mail, "lastCheck") > 0 ? " · zuletzt geprüft " + Fmt.Stamp(J.Long(mail, "lastCheck")) + (J.Str(mail, "lastError").Length > 0 ? " · ⚠ " + J.Str(mail, "lastError") : "") : "") : "Nicht eingerichtet.";
                unread.Text = J.Long(box.Result, "unread") + " ungelesen   ";
                inbox.Set(J.Arr(box.Result, "items").OrderByDescending(i => J.Long(i, "at")).Select(i => new Row(i, Fmt.Stamp(J.Long(i, "at")), Kind(J.Str(i, "kind")) + (J.Str(i, "source") == "mail" ? " ✉" : ""), J.Str(i, "name") + (J.Str(i, "email").Length > 0 ? " <" + J.Str(i, "email") + ">" : ""),
                    J.Str(i, "kind") == "request" ? J.Str(i, "title") + (J.Str(i, "text").Length > 0 ? " – " + J.Str(i, "text") : "") : J.Str(i, "kind") == "voice" ? "(Sprachnachricht)" : J.Str(i, "text"),
                    J.Str(i, "status") == "new" ? "neu" : J.Arr(i, "replies").Any() ? "beantwortet" : "erledigt")));
                var cfg = J.Get(box.Result, "config");
                requests.IsChecked = J.Bool(cfg, "requests");
                messages.IsChecked = J.Bool(cfg, "messages");
                voting.IsChecked = J.Bool(cfg, "voting");
                voice.IsChecked = J.Bool(cfg, "voice");
                polls.Set(J.Arr(pl.Result).Select(p => new Row(p, J.Str(p, "question"), string.Join(" · ", J.Strings(p, "options")), J.Str(p, "votes", "0"), J.Bool(p, "active") ? "ja" : "–")));
            }, "Hörer");
        }

        Task Reply() => C.Run(async () =>
        {
            var r = inbox.One;
            if (r == null) { C.Status("Zuerst einen Eintrag markieren", true); return; }
            var to = J.Str(r.El, "email");
            if (to.Length == 0) { C.Status("Für diesen Eintrag ist keine Mail-Adresse bekannt", true); return; }
            var v = Dlg.Form(C.Owner, "Antwort an " + (J.Str(r.El, "name").Length > 0 ? J.Str(r.El, "name") : to), "Senden",
                Field.Info("Nachricht", J.Str(r.El, "text")), Field.Multi("text", "Deine Antwort"));
            if (v == null) return;
            await C.Api.PostJ(C.St("/inbox/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/reply"), new { text = v["text"] }, 60);
            await Load();
            C.Ok("Antwort an " + to + " gesendet");
        }, "Antworten");

        Task CheckMail() => C.Run(async () =>
        {
            var r = await C.Api.PostJ(C.St("/studiomail/check"), null, 120);
            await Load();
            C.Ok(J.Str(r, "received") + " neue Mail(s) abgeholt");
        }, "Studiomail");

        Task MailSettings() => C.Run(async () =>
        {
            if (!J.Ok(mail)) mail = await C.Api.GetJ(C.St("/studiomail"));
            var presets = J.At(mail, "presets");
            var choices = new List<(string, string)> { ("", "Eigener Server / Webspace (selbst eintragen)") };
            if (presets.ValueKind == System.Text.Json.JsonValueKind.Object) foreach (var p in presets.EnumerateObject()) choices.Add((p.Name, J.Str(p.Value, "name")));
            var pre = Dlg.Form(C.Owner, "Mail-Anbieter", "Weiter", Field.Choice("preset", "Anbieter", "", choices.ToArray()));
            if (pre == null) return;
            var ps = pre["preset"].Length > 0 ? J.At(presets, pre["preset"]) : default;
            string Arr(string key, int i, string fb) => J.Ok(ps) ? J.Arr(ps, key).ElementAt(i).ToString() : fb;
            bool ArrB(string key, bool fb) => J.Ok(ps) ? J.Arr(ps, key).ElementAt(2).GetBoolean() : fb;
            var fields = new List<Field>();
            if (J.Str(ps, "note").Length > 0) fields.Add(Field.Info("Hinweis", J.Str(ps, "note")));
            fields.AddRange(new[]
            {
                Field.Check("enabled", "Studiomail aktiv (alle 2 Minuten neue Post abholen)", J.Bool(mail, "enabled") || J.Ok(ps)),
                Field.Text("address", "Studio-Adresse (Absender der Antworten)", J.Str(mail, "address")),
                Field.Text("name", "Angezeigter Name", J.Str(mail, "name")),
                Field.Text("user", "Benutzername (meist die Adresse)", J.Str(mail, "user")),
                Field.Password("password", J.Bool(mail, "hasPassword") ? "Passwort (leer = unverändert)" : "Passwort (ggf. App-Passwort)"),
                Field.Text("imapHost", "Posteingang (IMAP-Server)", Arr("imap", 0, J.Str(mail, "imapHost"))),
                Field.Text("imapPort", "IMAP-Port", Arr("imap", 1, J.Str(mail, "imapPort", "993"))),
                Field.Check("imapSecure", "IMAP mit SSL/TLS (sonst STARTTLS)", ArrB("imap", J.Bool(mail, "imapSecure", true))),
                Field.Text("smtpHost", "Postausgang (SMTP-Server)", Arr("smtp", 0, J.Str(mail, "smtpHost"))),
                Field.Text("smtpPort", "SMTP-Port", Arr("smtp", 1, J.Str(mail, "smtpPort", "465"))),
                Field.Check("smtpSecure", "SMTP mit SSL/TLS (sonst STARTTLS)", ArrB("smtp", J.Bool(mail, "smtpSecure", true))),
                Field.Text("folder", "Ordner", J.Str(mail, "folder", "INBOX")),
                Field.Multi("signature", "Signatur unter Antworten", J.Str(mail, "signature")),
            });
            var v = Dlg.Form(C.Owner, "Studiomail einrichten", "Verbinden & speichern", fields.ToArray());
            if (v == null) return;
            int.TryParse(v["imapPort"], out var ip);
            int.TryParse(v["smtpPort"], out var sp);
            var body = new Dictionary<string, object>
            {
                ["enabled"] = v["enabled"] == "true", ["address"] = v["address"], ["name"] = v["name"], ["user"] = v["user"],
                ["imapHost"] = v["imapHost"], ["imapPort"] = ip, ["imapSecure"] = v["imapSecure"] == "true",
                ["smtpHost"] = v["smtpHost"], ["smtpPort"] = sp, ["smtpSecure"] = v["smtpSecure"] == "true",
                ["folder"] = v["folder"], ["signature"] = v["signature"],
            };
            if (v["password"].Length > 0) body["password"] = v["password"];
            await C.Api.PutJ(C.St("/studiomail"), body, 60);
            await Load();
            C.Ok(v["enabled"] == "true" ? "Studiomail verbunden" : "Studiomail gespeichert (aus)");
        }, "Studiomail");

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
                if (action == "air") C.Ok("Auf Sendung gebracht (je nach Live/Automation: laut.fm-Playlist, Warteschlange oder Mediathek „Hörer“)");
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
