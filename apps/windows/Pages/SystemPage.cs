// System: Zustand und Updates, Sicherungen, Benutzer und Rollen, eigene API-Schlüssel, Protokoll, Neustart.
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
    sealed class SystemPage : View
    {
        readonly Table facts = new Table(("Eigenschaft", 220), ("Wert", 420));
        readonly Table backups = new Table(("Sicherung", 300), ("Größe", 90), ("Erstellt", 150));
        readonly Table users = new Table(("Benutzer", 160), ("Name", 180), ("Rollen", 140), ("Sender", 180), ("Gesperrt", 70));
        readonly Table tokens = new Table(("Name", 220), ("Rechte", 330), ("Angelegt", 130));
        readonly Table audit = new Table(("Zeit", 130), ("Bereich", 90), ("Ereignis", 160), ("Wer", 130));
        readonly TextBlock updateInfo = Kit.Text("", 13, false, Kit.Fg, true);
        List<JsonElement> roleList = new List<JsonElement>();

        public override string Title => "System";

        public SystemPage(Ctx c) : base(c)
        {
            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };

            tabs.Items.Add(new TabItem { Header = "Zustand & Update", Content = Tab(Kit.V(updateInfo), facts, null,
                Kit.Btn("Nach Updates suchen", () => CheckUpdate(true), null, true), Kit.Btn("Update installieren", InstallUpdate), Kit.Btn("Server neu starten", Restart), Kit.Btn("Protokoll der Engine", OpenLog)) });
            tabs.Items.Add(new TabItem { Header = "Sicherung", Content = Tab(Kit.Hint("Sicherung der Daten dieses Servers (Sender, Bibliothek-Verzeichnis, Einstellungen)."), backups, null,
                Kit.Btn("Sicherung erstellen", CreateBackup, null, true), Kit.Btn("Wiederherstellen …", Restore), Kit.Btn("Neu laden", () => Show())) });
            tabs.Items.Add(new TabItem { Header = "Benutzer", Content = Tab(Kit.Hint("Nur für Administratoren."), users, null,
                Kit.Btn("Benutzer anlegen …", AddUser, null, true), Kit.Btn("Rolle ändern …", ChangeRole), Kit.Btn("Sperren/Entsperren", ToggleLock), Kit.Btn("Löschen", DeleteUser)) });
            tabs.Items.Add(new TabItem { Header = "API-Schlüssel", Content = Tab(Kit.Hint("Eigene Schlüssel für Skripte und Werkzeuge (OBS, Stream Deck …). Dokumentation: docs/API.md."), tokens, null,
                Kit.Btn("Neuer Schlüssel …", NewToken, null, true), Kit.Btn("Widerrufen", RevokeToken)) });
            tabs.Items.Add(new TabItem { Header = "Protokoll", Content = Tab(Kit.Hint("Letzte Ereignisse (Anmeldungen, Änderungen, Aufnahmen)."), audit, null, Kit.Btn("Neu laden", () => Show())) });
            Children.Add(tabs);
        }

        static UIElement Tab(UIElement top, Table table, UIElement unused, params UIElement[] buttons)
        {
            var g = new Grid { Margin = new Thickness(8) };
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.Children.Add(top);
            Grid.SetRow(table, 1);
            g.Children.Add(table);
            var b = Kit.Wrap(buttons);
            Grid.SetRow(b, 2);
            g.Children.Add(b);
            return g;
        }

        public override async Task Show()
        {
            if (!C.Connected) return;
            await C.Run(async () =>
            {
                var sys = await C.Api.GetJ("/system");
                var rows = new List<Row>();
                Flatten(sys, "", rows, 0);
                try { Flatten(await C.Api.GetJ("/database"), "Datenbank.", rows, 0); } catch (ApiException) { }
                facts.Set(rows);
                await CheckUpdate(false);
            }, "System");
            await Quiet(async () =>
            {
                var b = await C.Api.GetJ("/backup");
                backups.Set(J.Arr(b).Select(x => new Row(x, J.Str(x, "file"), Fmt.Size(J.Long(x, "bytes")), J.Str(x, "createdAt").Replace("T", " ").Split('.')[0])));
            });
            await Quiet(async () =>
            {
                var u = await C.Api.GetJ("/users");
                roleList = J.Arr(u, "roles").ToList();
                users.Set(J.Arr(u, "users").Select(x => new Row(x, J.Str(x, "username"), J.Str(x, "name"), string.Join(", ", J.Strings(x, "roles").Select(RoleLabel)), string.Join(", ", J.Strings(x, "stationIds")), J.Bool(x, "disabled") || J.Bool(x, "locked") ? "ja" : "")));
            });
            await Quiet(async () =>
            {
                var t = await C.Api.GetJ("/me/tokens");
                tokens.Set(J.Arr(t).Where(x => !J.Ok(J.Get(x, "device"))).Select(x => new Row(x, J.Str(x, "name"), Fmt.Clip(string.Join(", ", J.Strings(x, "scopes")), 90), Fmt.Stamp(J.Long(x, "createdAt")))));
            });
            await Quiet(async () =>
            {
                var a = await C.Api.GetJ("/audit?limit=200");
                var list = J.Ok(J.Get(a, "entries")) ? J.Arr(a, "entries") : J.Arr(a);
                audit.Set(list.Reverse().Take(300).Select(x => new Row(x, Fmt.Stamp(J.Long(x, "at", J.Long(x, "ts"))), J.Str(x, "kind"), J.Str(x, "event"), J.Str(x, "actor"))));
            });
        }

        async Task Quiet(Func<Task> a) { try { await a(); } catch (ApiException) { /* kein Recht oder nicht vorhanden: Tabelle bleibt leer */ } }

        string RoleLabel(string id)
        {
            var r = roleList.FirstOrDefault(x => J.Str(x, "id") == id);
            return J.Ok(r) && J.Str(r, "label").Length > 0 ? J.Str(r, "label") : id;
        }

        static void Flatten(JsonElement e, string prefix, List<Row> rows, int depth)
        {
            if (e.ValueKind != JsonValueKind.Object) return;
            foreach (var p in e.EnumerateObject())
            {
                if (p.Value.ValueKind == JsonValueKind.Object && depth < 2) Flatten(p.Value, prefix + p.Name + ".", rows, depth + 1);
                else if (p.Value.ValueKind == JsonValueKind.Array) rows.Add(new Row(default, prefix + p.Name, Fmt.Clip(string.Join(", ", p.Value.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : x.GetRawText())), 120)));
                else if (p.Value.ValueKind != JsonValueKind.Object && p.Value.ValueKind != JsonValueKind.Null) rows.Add(new Row(default, prefix + p.Name, p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString()));
            }
        }

        // ---------- Update ----------

        async Task CheckUpdate(bool force)
        {
            await C.Run(async () =>
            {
                var u = await C.Api.GetJ("/update" + (force ? "?force=1" : ""), 40);
                var avail = J.Bool(u, "available") || J.Bool(u, "updateAvailable");
                updateInfo.Text = "Version " + J.Str(u, "current", J.Str(u, "version")) + (avail ? " · Update verfügbar: " + J.Str(u, "latest", J.Str(u, "latestVersion")) : " · aktuell") + "   ";
            }, "Update");
        }

        async Task InstallUpdate()
        {
            if (!Dlg.Confirm(C.Owner, "Update jetzt installieren? Der Server wird dabei neu gestartet.")) return;
            await C.Run(async () => { await C.Api.PostJ("/update/install", null, 600); C.Ok("Update wird installiert – der Server startet neu"); }, "Update");
        }

        async Task Restart()
        {
            if (!Dlg.Confirm(C.Owner, "Server neu starten? Automation und Streams unterbrechen kurz.")) return;
            await C.Run(async () => { await C.Api.PostJ("/system/restart"); C.Ok("Server startet neu …"); }, "Neustart");
        }

        void OpenLog()
        {
            var log = C.EngineLog();
            if (!string.IsNullOrEmpty(log) && System.IO.File.Exists(log)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true });
            else C.Status("Das Protokoll liegt auf dem Server (nur dieser PC hat eine lokale Datei)", true);
        }

        // ---------- Sicherung ----------

        async Task CreateBackup() => await C.Run(async () => { var r = await C.Api.PostJ("/backup", null, 300); await Show(); C.Ok("Sicherung erstellt: " + J.Str(r, "file")); }, "Sicherung");

        async Task Restore()
        {
            var r = backups.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Sicherung „" + J.Str(r.El, "file") + "“ wiederherstellen? Der aktuelle Stand wird ersetzt.")) return;
            await C.Run(async () => { await C.Api.PostJ("/backup/" + Uri.EscapeDataString(J.Str(r.El, "file")) + "/restore", null, 300); C.Ok("Wiederhergestellt – bitte den Server neu starten"); }, "Sicherung");
        }

        // ---------- Benutzer ----------

        (string, string)[] Roles() => roleList.Count > 0 ? roleList.Select(r => (J.Str(r, "id"), J.Str(r, "label"))).ToArray() : new[] { ("admin", "Administrator"), ("operator", "Sendeleitung"), ("editor", "Redaktion"), ("dj", "Moderation"), ("viewer", "Zuschauer") };

        async Task AddUser()
        {
            var v = Dlg.Form(C.Owner, "Benutzer anlegen", "Anlegen", Field.Text("username", "Benutzername"), Field.Text("name", "Anzeigename"),
                Field.Password("password", "Einmal-Passwort", "Mindestens 10 Zeichen, Buchstaben und Ziffer oder Sonderzeichen; wird bei der ersten Anmeldung geändert."),
                Field.Choice("role", "Rolle", "dj", Roles()), Field.Text("stations", "Sender (Kennungen mit Komma, leer = alle)"));
            if (v == null) return;
            var st = v["stations"].Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToArray();
            await C.Run(async () => { await C.Api.PostJ("/users", new { username = v["username"].Trim(), name = v["name"].Trim(), password = v["password"], roles = new[] { v["role"] }, stationIds = st.Length > 0 ? st : new[] { "*" } }); await Show(); }, "Benutzer");
        }

        async Task ChangeRole()
        {
            var r = users.One;
            if (r == null) return;
            var v = Dlg.Form(C.Owner, "Rolle ändern", "Speichern", Field.Info("Benutzer", J.Str(r.El, "username")), Field.Choice("role", "Neue Rolle", J.Strings(r.El, "roles").FirstOrDefault() ?? "dj", Roles()));
            if (v == null) return;
            await C.Run(async () => { await C.Api.PatchJ("/users/" + Uri.EscapeDataString(J.Str(r.El, "id")), new { roles = new[] { v["role"] } }); await Show(); }, "Benutzer");
        }

        async Task ToggleLock()
        {
            var r = users.One;
            if (r == null) return;
            var disabled = J.Bool(r.El, "disabled");
            await C.Run(async () => { await C.Api.PatchJ("/users/" + Uri.EscapeDataString(J.Str(r.El, "id")), new { disabled = !disabled }); await Show(); }, "Benutzer");
        }

        async Task DeleteUser()
        {
            var r = users.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Benutzer „" + J.Str(r.El, "username") + "“ löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ("/users/" + Uri.EscapeDataString(J.Str(r.El, "id"))); await Show(); }, "Benutzer");
        }

        // ---------- API-Schlüssel ----------

        async Task NewToken()
        {
            var v = Dlg.Form(C.Owner, "Neuer API-Schlüssel", "Erzeugen", Field.Text("name", "Name (z. B. OBS)"), Field.Check("readonly", "Nur lesen", false));
            if (v == null || v["name"].Trim().Length == 0) return;
            await C.Run(async () =>
            {
                var body = v["readonly"] == "true"
                    ? (object)new { name = v["name"].Trim(), scopes = new[] { "now_playing:read", "schedule:read", "branding:read", "queue:read", "cardwall:read", "sources:read", "automation:read", "media:read", "outputs:read" } }
                    : new { name = v["name"].Trim() };
                var r = await C.Api.PostJ("/me/tokens", body);
                var token = J.Str(r, "token");
                try { Clipboard.SetText(token); } catch { }
                Dlg.Info(C.Owner, "Dein Schlüssel (nur jetzt sichtbar, auch in der Zwischenablage):\n\n" + token + "\n\nHeader:  Authorization: Bearer <Schlüssel>", "API-Schlüssel");
                await Show();
            }, "API-Schlüssel");
        }

        async Task RevokeToken()
        {
            var r = tokens.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Schlüssel „" + J.Str(r.El, "name") + "“ widerrufen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ("/me/tokens/" + Uri.EscapeDataString(J.Str(r.El, "id"))); await Show(); }, "API-Schlüssel");
        }
    }
}
