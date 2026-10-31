// KI: Assistent (Gespräch mit den eingerichteten KI-Anbietern des Senders) und Anbieter-Verwaltung für Administratoren –
// lokale KI auf diesem PC/Server oder im eigenen Netz finden und übernehmen, Cloud-Anbieter aus Vorlagen, eigene Anbieter
// (OpenAI-kompatible Adresse, eigener Key-Header, Zusatz-Header, Query). Keys gehen nur an den Server und werden dort
// verschlüsselt gespeichert; angezeigt wird nur, ob einer hinterlegt ist.
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
    sealed class AiPage : View
    {
        readonly TextBox log = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Kit.PanelBg, Foreground = Kit.Fg, BorderBrush = Kit.Line, Padding = new Thickness(8) };
        readonly TextBox input = Kit.Box();
        readonly TextBlock state = Kit.Text("", 12, false, Kit.Muted, true);

        readonly Table providers = new Table(("Name", 200), ("Art", 70), ("Typ", 150), ("Adresse", 260), ("Key", 100));
        readonly Table found = new Table(("Server", 170), ("Art", 70), ("Adresse", 260), ("Modelle", 240));
        readonly TextBlock provState = Kit.Text("", 12, false, Kit.Muted, true);
        JsonElement settings;
        bool admin;

        public override string Title => "KI";

        public AiPage(Ctx c) : base(c)
        {
            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };
            tabs.Items.Add(new TabItem { Header = "Assistent", Content = BuildChat() });
            tabs.Items.Add(new TabItem { Header = "Anbieter & lokale KI", Content = BuildProviders() });
            Children.Add(tabs);
        }

        UIElement BuildChat()
        {
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            state.Margin = new Thickness(0, 0, 0, 8);
            g.Children.Add(state);
            Grid.SetRow(log, 1);
            g.Children.Add(log);
            input.AcceptsReturn = true;
            input.TextWrapping = TextWrapping.Wrap;
            input.MinHeight = 60;
            input.MaxHeight = 140;
            input.ToolTip = "Frage oder Auftrag, z. B. „Schreibe eine 20-Sekunden-Ansage für die Morgensendung“";
            var send = Kit.Btn("Senden", Send, null, true);
            var bottom = new DockPanel { Margin = new Thickness(0, 8, 0, 0) };
            var buttons = Kit.V(send, Kit.Btn("Verlauf löschen", Clear));
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            bottom.Children.Add(input);
            Grid.SetRow(bottom, 2);
            g.Children.Add(bottom);
            return g;
        }

        UIElement BuildProviders()
        {
            var g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(3, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(2, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var head = Kit.V(provState, Kit.Wrap(
                Kit.Btn("＋ Text-Anbieter …", () => Add("text"), "Lokal (Ollama, LM Studio …), Cloud (Mistral, OpenRouter …) oder eigener Anbieter", true),
                Kit.Btn("＋ Sprach-Anbieter …", () => Add("voice")),
                Kit.Btn("🔍 Lokale KI suchen …", Discover, "Ollama, LM Studio, llama.cpp, vLLM, Jan, KoboldCpp, Kokoro auf diesem PC/Server oder einem Rechner im Netz"),
                Kit.Btn("Testen", Test, "Verbindung prüfen und Modelle abrufen"),
                Kit.Btn("Bearbeiten …", Edit),
                Kit.Btn("Löschen", Remove)));
            head.Margin = new Thickness(0, 0, 0, 8);
            g.Children.Add(head);
            Grid.SetRow(providers, 1);
            g.Children.Add(providers);
            var fh = Kit.Wrap(Kit.Text("Gefundene lokale KI-Server", 13, true), Kit.Btn("Übernehmen …", Adopt, "Ausgewählten Server als Anbieter anlegen"));
            fh.Margin = new Thickness(0, 12, 0, 4);
            Grid.SetRow(fh, 2);
            g.Children.Add(fh);
            Grid.SetRow(found, 3);
            g.Children.Add(found);
            var hint = Kit.Hint("Zusatz-Header und Key-Header für eigene Gateways lassen sich unter „Bearbeiten …“ setzen. Kosten und Budgets: Studio unter „Weitere Funktionen“ → KI.");
            hint.Margin = new Thickness(0, 8, 0, 0);
            Grid.SetRow(hint, 4);
            g.Children.Add(hint);
            return g;
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var chat = await C.Api.GetJ(C.St("/ai/chat"));
                log.Text = string.Join("\n\n", J.Arr(chat).Select(m => (J.Str(m, "role") == "user" ? "Du: " : "KI: ") + J.Str(m, "text")));
                log.ScrollToEnd();
                await LoadProviders();
            }, "KI");
        }

        async Task LoadProviders()
        {
            try
            {
                settings = await C.Api.GetJ("/ai/settings");
                admin = true;
            }
            catch (ApiException)
            {
                admin = false;
                providers.Set(new Row[0]);
                provState.Text = "KI-Anbieter verwaltet ein Administrator dieses Servers.";
                state.Text = "KI-Anbieter werden vom Server verwaltet.";
                return;
            }
            var list = J.Arr(settings, "providers").ToList();
            providers.Set(list.Select(p => new Row(p,
                J.Str(p, "name") + (J.Bool(p, "local") ? "  · lokal" : "") + (J.Bool(p, "enabled", true) ? "" : "  (aus)"),
                J.Str(p, "role") == "voice" ? "Sprache" : "Text",
                KindLabel(J.Str(p, "kind")),
                J.Str(p, "baseUrl"),
                J.Bool(p, "hasKey") ? "hinterlegt" : J.Bool(p, "local") || J.Str(p, "kind") == "piper" ? "nicht nötig" : "–")));
            var local = list.Count(p => J.Bool(p, "local"));
            provState.Text = list.Count == 0 ? "Noch kein KI-Anbieter eingerichtet. Lokale KI läuft ohne Key und offline – „Lokale KI suchen“ findet laufende Server selbst." : list.Count + " Anbieter, davon " + local + " lokal.";
            state.Text = list.Count == 0 ? "Noch kein KI-Anbieter eingerichtet – unter „Anbieter & lokale KI“ anlegen." : "KI-Anbieter: " + string.Join(", ", list.Where(p => J.Bool(p, "enabled", true)).Select(p => J.Str(p, "name")));
        }

        static string KindLabel(string k) => k == "openai" ? "OpenAI" : k == "anthropic" ? "Anthropic" : k == "google" ? "Google Gemini" : k == "openai_compat" ? "OpenAI-kompatibel" : k == "elevenlabs" ? "ElevenLabs" : k == "piper" ? "Piper (offline)" : k;

        IEnumerable<JsonElement> Presets(string role) => J.Arr(settings, "presets").Where(p => J.Str(p, "role") == role);

        /// <summary>Alle Anbieter für das Speichern: ohne „hasKey“, Keys bleiben unverändert (nicht mitgeschickt).</summary>
        List<Dictionary<string, object>> Current() => J.Arr(settings, "providers").Select(p =>
        {
            var d = new Dictionary<string, object>();
            foreach (var prop in p.EnumerateObject()) if (prop.Name != "hasKey") d[prop.Name] = prop.Value.Clone();
            return d;
        }).ToList();

        async Task Save(List<Dictionary<string, object>> next, string ok)
        {
            await C.Api.PutJ("/ai/settings", new { providers = next });
            C.Ok(ok);
            await LoadProviders();
        }

        static string Slug(string name, IEnumerable<string> taken)
        {
            var s = new string((name ?? "").ToLowerInvariant().Select(ch => ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' ? ch : '-').ToArray()).Trim('-');
            while (s.Contains("--")) s = s.Replace("--", "-");
            if (s.Length == 0) s = "ki";
            if (s.Length > 30) s = s.Substring(0, 30).Trim('-');
            var id = s;
            for (var n = 2; taken.Contains(id); n++) id = s + "-" + n;
            return id;
        }

        bool NeedAdmin()
        {
            if (admin) return true;
            C.Status("KI-Anbieter kann nur ein Administrator dieses Servers einrichten", true);
            return false;
        }

        Task Add(string role) => C.Run(async () =>
        {
            if (!NeedAdmin()) return;
            var presets = Presets(role).ToList();
            var choices = presets.Where(p => J.Bool(p, "local")).Select(p => (J.Str(p, "id"), "Lokal · " + J.Str(p, "label")))
                .Concat(presets.Where(p => !J.Bool(p, "local")).Select(p => (J.Str(p, "id"), "Cloud · " + J.Str(p, "label"))))
                .Concat(new[] { ("custom", "Eigener Anbieter (frei konfigurierbar)") }).ToList();
            var pick = Dlg.Pick(C.Owner, role == "voice" ? "Sprach-Anbieter anlegen" : "Text-Anbieter anlegen", choices);
            if (pick == null) return;
            var pre = presets.FirstOrDefault(p => J.Str(p, "id") == pick);
            await EditDialog(null, role, J.Ok(pre) ? pre : (JsonElement?)null, null);
        }, "KI-Anbieter");

        /// <summary>Formular für neuen oder bestehenden Anbieter. <paramref name="pre"/> = Vorlage, <paramref name="foundServer"/> = gefundener lokaler Server.</summary>
        async Task EditDialog(JsonElement? existing, string role, JsonElement? pre, JsonElement? foundServer)
        {
            var e = existing ?? default;
            var has = existing.HasValue;
            string Get(string k, string fb = "") => has ? J.Str(e, k, fb) : fb;
            var kindsDefault = role == "voice" ? "openai_compat" : "openai_compat";
            var name = has ? J.Str(e, "name") : foundServer.HasValue ? J.Str(foundServer.Value, "label") + (J.Str(foundServer.Value, "host") == "127.0.0.1" ? "" : " (" + J.Str(foundServer.Value, "host") + ")") : pre.HasValue ? J.Str(pre.Value, "label") : "";
            var kind = has ? J.Str(e, "kind") : pre.HasValue ? J.Str(pre.Value, "kind") : kindsDefault;
            var baseUrl = has ? J.Str(e, "baseUrl") : foundServer.HasValue ? J.Str(foundServer.Value, "baseUrl") : pre.HasValue ? J.Str(pre.Value, "baseUrl") : "";
            var local = has ? J.Bool(e, "local") : foundServer.HasValue || pre.HasValue && J.Bool(pre.Value, "local");
            var headersText = has && J.Ok(J.At(e, "headers")) ? string.Join("\n", J.At(e, "headers").EnumerateObject().Select(h => h.Name + ": " + h.Value.GetString())) : "";
            var kinds = J.Arr(settings, "kinds." + role).Select(k => k.GetString()).Select(k => (k, KindLabel(k))).ToArray();
            var fields = new List<Field>();
            if (pre.HasValue && J.Str(pre.Value, "hint").Length > 0) fields.Add(Field.Info("Hinweis", J.Str(pre.Value, "hint")));
            if (foundServer.HasValue) fields.Add(Field.Info("Gefunden", J.Str(foundServer.Value, "baseUrl") + " · Modelle: " + string.Join(", ", J.Strings(foundServer.Value, "models").Take(8))));
            fields.Add(Field.Text("name", "Name", name));
            fields.Add(Field.Choice("kind", "Typ", kind, kinds));
            fields.Add(Field.Password("key", has && J.Bool(e, "hasKey") ? "API-Key (leer = unverändert, „-“ = löschen)" : local ? "API-Key (lokal nicht nötig)" : "API-Key"));
            fields.Add(Field.Text("baseUrl", "Adresse (Basis-URL)", baseUrl, "Lokal z. B. http://localhost:11434/v1 · anderer Rechner http://192.168.1.20:11434/v1 · bei OpenAI/Anthropic/Google leer"));
            if (role == "voice") fields.Add(Field.Text("binPath", "Piper: Pfad zu piper.exe (nur Typ Piper)", Get("binPath")));
            fields.Add(Field.Check("local", "Läuft auf dem eigenen PC/Server (lokal, ohne Key)", local));
            fields.Add(Field.Check("enabled", "Aktiv", !has || J.Bool(e, "enabled", true)));
            fields.Add(Field.Text("authHeader", "Erweitert: Header für den Key", has ? Get("authHeader") : pre.HasValue ? J.Str(pre.Value, "authHeader") : "", "leer = Authorization; Azure: api-key"));
            fields.Add(Field.Text("authScheme", "Erweitert: Vorsatz vor dem Key", has ? Get("authScheme", "Bearer") : pre.HasValue && J.Ok(J.At(pre.Value, "authScheme")) ? J.Str(pre.Value, "authScheme") : "Bearer", "z. B. Bearer; leer = nur der Key"));
            fields.Add(Field.Multi("headers", "Erweitert: Zusatz-Header (je Zeile „Name: Wert“, {key} = gespeicherter Key)", headersText));
            fields.Add(Field.Text("query", "Erweitert: Query-Parameter", has ? Get("query") : pre.HasValue ? J.Str(pre.Value, "query") : "", "z. B. api-version=2024-10-21"));
            var v = Dlg.Form(C.Owner, has ? "Anbieter: " + J.Str(e, "name") : "KI-Anbieter einrichten", "Speichern", fields.ToArray());
            if (v == null) return;
            if (v["name"].Trim().Length == 0) { C.Status("Bitte einen Namen angeben", true); return; }

            var next = Current();
            var id = has ? J.Str(e, "id") : Slug(v["name"], next.Select(d => d["id"].ToString()));
            var entry = new Dictionary<string, object>
            {
                ["id"] = id, ["role"] = role, ["name"] = v["name"].Trim(), ["kind"] = v["kind"], ["baseUrl"] = v["baseUrl"].Trim(), ["enabled"] = v["enabled"] == "true", ["local"] = v["local"] == "true",
                ["authHeader"] = v["authHeader"].Trim(), ["authScheme"] = v["authScheme"].Trim(), ["headers"] = v["headers"], ["query"] = v["query"].Trim(),
            };
            if (role == "voice") entry["binPath"] = v["binPath"].Trim();
            if (v["key"].Trim().Length > 0) entry["key"] = v["key"].Trim();
            var presetId = has ? Get("preset") : pre.HasValue ? J.Str(pre.Value, "id") : foundServer.HasValue ? J.Str(foundServer.Value, "preset") : "";
            if (presetId.Length > 0) entry["preset"] = presetId;
            var index = next.FindIndex(d => d["id"].ToString() == id);
            if (index >= 0) next[index] = entry; else next.Add(entry);
            await Save(next, has ? "Anbieter gespeichert" : "Anbieter angelegt");
        }

        Task Edit() => C.Run(async () =>
        {
            if (!NeedAdmin()) return;
            var r = providers.One;
            if (r == null) { C.Status("Bitte einen Anbieter in der Liste wählen", true); return; }
            await EditDialog(r.El, J.Str(r.El, "role") == "voice" ? "voice" : "text", null, null);
        }, "KI-Anbieter");

        Task Remove() => C.Run(async () =>
        {
            if (!NeedAdmin()) return;
            var r = providers.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Anbieter „" + J.Str(r.El, "name") + "“ löschen? Ein gespeicherter Key wird mit entfernt.")) return;
            var id = J.Str(r.El, "id");
            await Save(Current().Where(d => d["id"].ToString() != id).ToList(), "Anbieter gelöscht");
        }, "KI-Anbieter");

        Task Test() => C.Run(async () =>
        {
            var r = providers.One;
            if (r == null) { C.Status("Bitte einen Anbieter in der Liste wählen", true); return; }
            var voices = J.Str(r.El, "kind") == "elevenlabs";
            if (J.Str(r.El, "role") == "voice" && !voices) { C.Ok("Sprach-Anbieter testen: im Studio unter KI → Werkstatt einen kurzen Text vertonen"); return; }
            C.Status("Teste " + J.Str(r.El, "name") + " …", false);
            var list = await C.Api.GetJ("/ai/providers/" + Uri.EscapeDataString(J.Str(r.El, "id")) + (voices ? "/voices" : "/models"), 30);
            var n = J.Arr(list).Count();
            C.Ok(J.Str(r.El, "name") + ": Verbindung in Ordnung – " + n + (voices ? " Stimmen" : " Modelle") + (n > 0 && !voices ? " (z. B. " + string.Join(", ", J.Arr(list).Take(3).Select(x => x.GetString())) + ")" : ""));
        }, "KI-Anbieter");

        Task Discover() => C.Run(async () =>
        {
            if (!NeedAdmin()) return;
            var v = Dlg.Form(C.Owner, "Lokale KI suchen", "Suchen",
                Field.Info("Gesucht wird", "Ollama, LM Studio, llama.cpp, vLLM, Jan, KoboldCpp, text-generation-webui und Kokoro auf dem Server, mit dem diese App verbunden ist."),
                Field.Text("host", "Zusätzlich auf Rechner (optional)", "", "Name oder IP im eigenen Netz, z. B. 192.168.1.20 – ohne http:// und Port. Ollama dort mit OLLAMA_HOST=0.0.0.0 starten."));
            if (v == null) return;
            C.Status("Suche lokale KI-Server …", false);
            var host = v["host"].Trim();
            var r = await C.Api.PostJ("/ai/discover", host.Length > 0 ? (object)new { host } : new { }, 30);
            var list = J.Arr(r, "found").ToList();
            found.Set(list.Select(f => new Row(f, J.Str(f, "label"), J.Str(f, "role") == "voice" ? "Sprache" : "Text", J.Str(f, "baseUrl"),
                J.Strings(f, "models").Any() ? string.Join(", ", J.Strings(f, "models").Take(4)) + (J.Strings(f, "models").Count() > 4 ? " …" : "") : "keine Modelle geladen")));
            if (list.Count > 0) C.Ok(list.Count + " lokale KI-Server gefunden – auswählen und „Übernehmen …“");
            else C.Status("Kein laufender KI-Server gefunden (" + string.Join(", ", J.Strings(r, "hosts")) + ")", true);
        }, "Lokale KI");

        Task Adopt() => C.Run(async () =>
        {
            if (!NeedAdmin()) return;
            var r = found.One;
            if (r == null) { C.Status("Bitte erst „Lokale KI suchen“ und einen Server auswählen", true); return; }
            var pre = J.Arr(settings, "presets").FirstOrDefault(p => J.Str(p, "id") == J.Str(r.El, "preset"));
            await EditDialog(null, J.Str(r.El, "role") == "voice" ? "voice" : "text", J.Ok(pre) ? pre : (JsonElement?)null, r.El);
        }, "Lokale KI");

        async Task Send()
        {
            var text = input.Text.Trim();
            if (text.Length == 0) return;
            log.Text += (log.Text.Length > 0 ? "\n\n" : "") + "Du: " + text;
            input.Text = "";
            await C.Run(async () =>
            {
                C.Status("Die KI schreibt …", false);
                var r = await C.Api.PostJ(C.St("/ai/chat"), new { prompt = text }, 300);
                log.Text += "\n\nKI: " + J.Str(r, "reply");
                log.ScrollToEnd();
                C.Ok("Fertig" + (J.Str(r, "model").Length > 0 ? " · " + J.Str(r, "model") : ""));
            }, "KI");
        }

        async Task Clear()
        {
            if (!Dlg.Confirm(C.Owner, "Den Gesprächsverlauf löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/ai/chat")); log.Text = ""; }, "KI");
        }
    }
}
