// Encoder anlegen und bearbeiten – gemeinsam für die Seite „Encoder & Quellen“ und das Live-Studio, damit beide
// denselben Weg gehen: Icecast/SHOUTcast von Hand, laut.fm mit den Zugangsdaten der verbundenen Station oder
// einer anderen laut.fm-Station per Token. Neue Encoder sind getrennt, bis „Verbinden“ gedrückt wird.
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
    static class EncoderDialogs
    {
        /// <summary>Ist dieser Encoder ein laut.fm-Ausgang?</summary>
        public static bool IsLautFm(JsonElement o) => J.Str(o, "host").IndexOf("laut.fm", StringComparison.OrdinalIgnoreCase) >= 0 || J.Str(o, "name").StartsWith("laut.fm", StringComparison.OrdinalIgnoreCase);

        /// <summary>Auswahl zum Hinzufügen direkt am Knopf: laut.fm (dieser Sender), laut.fm (andere Station) oder Icecast/SHOUTcast.</summary>
        public static void ShowAddMenu(Ctx C, FrameworkElement anchor, bool lautfmLinked, Func<Task> reload)
        {
            var menu = new ContextMenu { PlacementTarget = anchor, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };
            void Item(string header, string tip, bool enabled, Func<Task<bool>> act)
            {
                var mi = new MenuItem { Header = header, ToolTip = tip, IsEnabled = enabled };
                mi.Click += async (s, e) => { if (await act()) await reload(); };
                menu.Items.Add(mi);
            }
            Item("laut.fm – " + C.StationName, lautfmLinked ? "Zugangsdaten der verbundenen laut.fm-Station übernehmen" : "Dieser Sender ist nicht mit laut.fm verbunden (laut.fm verwalten)", lautfmLinked, () => AddLautFmOwn(C));
            Item("laut.fm – andere Station (Token) …", "Zusätzlich live auf eine weitere laut.fm-Station senden", true, () => AddLautFmOther(C));
            Item("Icecast / SHOUTcast …", "Eigenen Server oder Hoster eintragen", true, () => Edit(C, null));
            menu.IsOpen = true;
        }

        public static async Task<bool> AddLautFmOwn(Ctx C) => await C.Run(async () =>
        {
            await C.Api.PostJ(C.St("/lautfm/live-output"), new { }, 60);
            C.Ok("laut.fm-Encoder steht bereit – zum Senden „Verbinden“");
        }, "laut.fm-Encoder");

        public static async Task<bool> AddLautFmOther(Ctx C)
        {
            var v = Dlg.Form(C.Owner, "Live auf eine weitere laut.fm-Station", "Weiter",
                Field.Info("So geht's", "Token der anderen Station unter radioadmin.laut.fm → Tokens erzeugen und hier einfügen. Das Token wird nur zum Abholen der Live-Zugangsdaten genutzt."),
                Field.Password("token", "laut.fm-Token"));
            if (v == null || v["token"].Trim().Length == 0) return false;
            JsonElement r = default;
            if (!await C.Run(async () => r = await C.Api.PostJ(C.St("/lautfm/relay-output"), new { token = v["token"].Trim() }, 60), "laut.fm")) return false;
            if (!J.Ok(J.Get(r, "stations"))) { C.Ok("laut.fm-Encoder angelegt – zum Senden „Verbinden“"); return true; }
            // mehrere Stationen im Konto: wählen lassen statt raten
            var pick = Dlg.Pick(C.Owner, "Welche laut.fm-Station?", J.Arr(r, "stations").Select(s => (J.Str(s, "id"), J.Str(s, "displayName", J.Str(s, "name")))).ToList());
            if (pick == null) return false;
            return await C.Run(async () =>
            {
                await C.Api.PostJ(C.St("/lautfm/relay-output"), new { token = v["token"].Trim(), lautfmStationId = int.Parse(pick) }, 60);
                C.Ok("laut.fm-Encoder angelegt – zum Senden „Verbinden“");
            }, "laut.fm");
        }

        /// <summary>Icecast/SHOUTcast-Encoder anlegen (existing == null) oder bearbeiten.</summary>
        public static async Task<bool> Edit(Ctx C, JsonElement? existing)
        {
            var o = existing ?? default;
            var isNew = !J.Ok(o);
            var profileChoices = new List<(string, string)> { ("", "Hauptstream (Standardprofil)") };
            try
            {
                var p = await C.Api.GetJ(C.St("/stream-profiles"));
                profileChoices.AddRange(J.Arr(p).Select(x => (J.Str(x, "id"), J.Str(x, "name") + " (" + J.Str(x, "format").ToUpperInvariant() + " " + J.Str(x, "bitrateKbps") + "k)")));
            }
            catch (ApiException) { /* ohne Leserecht nur der Hauptstream */ }
            var fields = new List<Field>
            {
                Field.Text("name", "Name", J.Str(o, "name", "Hauptstream")),
                Field.Choice("type", "Art", J.Str(o, "type", "icecast"), ("icecast", "Icecast (HTTP PUT)"), ("shoutcast", "SHOUTcast v1/v2 (nur MP3/AAC)")),
                Field.Text("host", "Host", J.Str(o, "host")), Field.Text("port", "Port", J.Str(o, "port", "8000")), Field.Text("mount", "Mountpoint", J.Str(o, "mount", "/stream")),
                Field.Text("username", "Benutzer", J.Str(o, "username", "source")),
                Field.Password("password", isNew ? "Passwort" : "Passwort (leer = unverändert)"),
                Field.Text("streamId", "SHOUTcast v2: Stream-ID (leer = v1)", J.Str(o, "streamId")),
                Field.Text("bitrateKbps", "Angezeigte Bitrate (kbit/s)", J.Str(o, "bitrateKbps")),
                Field.Choice("profileId", "Encoder-Profil", J.Str(o, "profileId"), profileChoices.ToArray()),
                Field.Text("priority", "Priority-Parameter (optional)", J.Str(o, "priority"), "Hängt ?prio=<n> an den Mountpoint an (z. B. laut.fm). Leer = aus."),
                Field.Check("tls", "TLS (https)", J.Bool(o, "tls")), Field.Check("enabled", isNew ? "Gleich nach dem Speichern verbinden" : "Verbunden", isNew ? false : J.Bool(o, "enabled", true)),
            };
            var v = Dlg.Form(C.Owner, isNew ? "Encoder anlegen" : "Encoder: " + J.Str(o, "name"), "Speichern", fields.ToArray());
            if (v == null) return false;
            var body = new Dictionary<string, object>
            {
                ["name"] = v["name"], ["type"] = v["type"], ["host"] = v["host"].Trim(), ["port"] = Num(v["port"], 8000), ["mount"] = v["mount"].Trim(), ["username"] = v["username"].Trim(),
                ["tls"] = v["tls"] == "true", ["enabled"] = v["enabled"] == "true", ["profileId"] = v["profileId"],
                ["priority"] = v["priority"].Trim().Length > 0 ? (object)Num(v["priority"], 0) : null,
            };
            if (v["password"].Length > 0) body["password"] = v["password"];
            if (v["streamId"].Trim().Length > 0) body["streamId"] = Num(v["streamId"], 0);
            if (v["bitrateKbps"].Trim().Length > 0) body["bitrateKbps"] = Num(v["bitrateKbps"], 128);
            return await C.Run(async () =>
            {
                if (isNew) await C.Api.PostJ(C.St("/outputs"), body); else await C.Api.PatchJ(C.St("/outputs/" + Uri.EscapeDataString(J.Str(o, "id"))), body);
                C.Ok(isNew ? "Encoder angelegt" + (v["enabled"] == "true" ? " und verbunden" : " – zum Senden „Verbinden“") : "Encoder gespeichert");
            }, "Encoder");
        }

        static int Num(string s, int fallback) => int.TryParse((s ?? "").Trim(), out var n) ? n : fallback;
    }
}
