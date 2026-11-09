// Podcast: Feed-Adresse, Einstellungen, Episoden veröffentlichen, öffentliche Adresse prüfen, Upload zu Buzzsprout/Podbean.
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class PodcastPage : View
    {
        readonly TextBox feed = Kit.Box("", 520);
        readonly TextBox hostFeed = Kit.Box("", 520);
        readonly TextBlock info = Kit.Text("", 13, false, Kit.Muted, true);
        readonly TextBlock hostInfo = Kit.Text("", 13, false, Kit.Muted, true);
        readonly Table episodes = new Table(("Titel", 300), ("Status", 100), ("Veröffentlicht", 110), ("Beim Hoster", 120), ("Nr.", 50));
        JsonElement overview;

        public override string Title => "Podcast";

        public PodcastPage(Ctx c) : base(c)
        {
            feed.IsReadOnly = true;
            hostFeed.IsReadOnly = true;
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var top = Kit.V(
                Kit.Card("Eigener Feed (dieser Server)", Kit.V(info,
                    Kit.H(feed, Kit.Btn("Kopieren", () => Copy(feed.Text))),
                    Kit.Wrap(Kit.Btn("Einstellungen …", Settings), Kit.Btn("Cover …", Cover), Kit.Btn("Öffentliche Adresse …", PublicUrl, "Adresse deines Servers im Internet (z. B. Tunnel)"), Kit.Btn("Erreichbarkeit prüfen", Check))),
                    "Diese Adresse bei Apple Podcasts, Spotify for Creators & Co. eintragen – sie muss aus dem Internet erreichbar sein."),
                Kit.Card("Kostenloser Hoster (Buzzsprout, Podbean)", Kit.V(hostInfo,
                    Kit.H(hostFeed, Kit.Btn("Kopieren", () => Copy(hostFeed.Text))),
                    Kit.Wrap(Kit.Btn("Hoster einrichten …", Host), Kit.Btn("Verbindung testen", TestHost))),
                    "Der Hoster betreibt den öffentlichen Feed; dein Server muss nicht erreichbar sein."));
            Children.Add(top);
            SetRow(episodes, 1);
            Children.Add(episodes);
            var b = Kit.Wrap(Kit.Btn("Veröffentlichen / Zurückziehen", TogglePublished, null, true), Kit.Btn("Bearbeiten …", EditEpisode), Kit.Btn("Zum Hoster hochladen", Push), Kit.Btn("Löschen", Delete),
                Kit.Text("   Episoden entstehen aus Mitschnitten (Aufnahme & Mitschnitte → „Als Podcast-Episode“).", 12, false, Kit.Muted));
            SetRow(b, 2);
            Children.Add(b);
        }

        public override Task Show() => Load();

        public override void OnEvent(string type) { if (type == "podcast.changed" && IsVisible) _ = Load(); }

        void Copy(string text) { if (!string.IsNullOrEmpty(text)) { try { Clipboard.SetText(text); C.Ok("Kopiert"); } catch { C.Status("Zwischenablage nicht verfügbar", true); } } }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                overview = await C.Api.GetJ(C.St("/podcast"));
                var cfg = J.Get(overview, "config");
                var publicFeed = J.Str(overview, "feedUrl");
                var own = C.Api.Url("/public/stations/" + Uri.EscapeDataString(C.StationId) + "/podcast.xml");
                feed.Text = publicFeed.Length > 0 ? publicFeed : own;
                info.Text = publicFeed.Length > 0 ? "„" + J.Str(cfg, "title") + "“ – öffentliche Adresse eingetragen." :
                    "„" + J.Str(cfg, "title") + "“ – noch keine öffentliche Adresse: diese Adresse gilt nur im eigenen Netz" + (C.IsLocal ? " (dieser PC)." : ".");
                var host = J.Get(overview, "host");
                if (J.Ok(host))
                {
                    var kind = J.Str(host, "kind") == "buzzsprout" ? "Buzzsprout" : "Podbean";
                    hostInfo.Text = kind + (J.Bool(host, "hasCredentials") ? " verbunden" : " – Zugangsdaten fehlen") + (J.Bool(host, "autoPush") ? " · neue Auto-Episoden werden automatisch hochgeladen" : "");
                    hostFeed.Text = J.Str(host, "feedUrl");
                }
                else { hostInfo.Text = "Kein Hoster eingerichtet."; hostFeed.Text = ""; }
                episodes.Set(J.Arr(overview, "episodes").Select(e => new Row(e, J.Str(e, "title"), J.Long(e, "publishedAt") > 0 ? "veröffentlicht" : "Entwurf",
                    J.Long(e, "publishedAt") > 0 ? Fmt.Stamp(J.Long(e, "publishedAt")) : "–",
                    J.Ok(J.Get(e, "hosted")) ? (J.Str(e, "hosted.kind") == "buzzsprout" ? "Buzzsprout" : "Podbean") : "–", J.Str(e, "episodeNumber"))));
            }, "Podcast");
        }

        async Task Settings()
        {
            var cfg = J.Get(overview, "config");
            var auto = J.Get(cfg, "auto");
            var v = Dlg.Form(C.Owner, "Podcast-Einstellungen", "Speichern",
                Field.Text("title", "Titel", J.Str(cfg, "title")), Field.Multi("description", "Beschreibung", J.Str(cfg, "description")),
                Field.Text("author", "Autor/Sprecher", J.Str(cfg, "author")), Field.Text("language", "Sprache (z. B. de-de)", J.Str(cfg, "language", "de-de")),
                Field.Text("category", "Kategorie (iTunes)", J.Str(cfg, "category")), Field.Check("explicit", "Enthält nicht jugendfreie Inhalte", J.Bool(cfg, "explicit")),
                Field.Info("Automatisch veröffentlichen", "Jeder fertige Mitschnitt wird nach Vorlage zur Episode. Platzhalter: {label} {date} {time} {weekday} {duration} {station} {n}"),
                Field.Check("autoEnabled", "Mitschnitte automatisch als Episode anlegen", J.Bool(auto, "enabled")),
                Field.Check("autoPublish", "Sofort im Feed veröffentlichen (sonst Entwurf)", J.Bool(auto, "publish")),
                Field.Text("autoTitle", "Titel-Vorlage", J.Str(auto, "titleTemplate", "{label} vom {date}")),
                Field.Text("autoMin", "Mindestdauer in Minuten (0 = alle)", J.Str(auto, "minMinutes", "0")));
            if (v == null) return;
            int.TryParse(v["autoMin"], out var min);
            await C.Run(async () =>
            {
                await C.Api.PutJ(C.St("/podcast"), new
                {
                    title = v["title"], description = v["description"], author = v["author"], language = v["language"], category = v["category"], explicit_ = v["explicit"] == "true",
                    auto = new { enabled = v["autoEnabled"] == "true", publish = v["autoPublish"] == "true", titleTemplate = v["autoTitle"], minMinutes = min },
                }.ToServer());
                await Load();
                C.Ok("Gespeichert");
            }, "Podcast");
        }

        async Task Cover()
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Title = "Podcast-Cover", Filter = "Bilder|*.png;*.jpg;*.jpeg;*.webp" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var ext = Path.GetExtension(dlg.FileName).ToLowerInvariant();
            var type = ext == ".png" ? "image/png" : ext == ".webp" ? "image/webp" : "image/jpeg";
            await C.Run(async () => { await C.Api.UploadFile(C.St("/podcast/cover"), dlg.FileName, type); await Load(); C.Ok("Cover gespeichert"); }, "Cover");
        }

        async Task PublicUrl()
        {
            var v = Dlg.Form(C.Owner, "Öffentliche Adresse", "Speichern",
                Field.Text("url", "Adresse dieses Servers", J.Str(J.Get(overview, "config"), "publicBaseUrl"), "z. B. https://radio.example.de oder https://mein-pc.tailnet.ts.net – leer lassen entfernt sie. Anleitung für kostenlose Tunnel: docs/PODCAST_HOSTING.md"));
            if (v == null) return;
            await C.Run(async () => { await C.Api.PutJ(C.St("/podcast"), new { publicBaseUrl = v["url"].Trim() }); await Load(); }, "Podcast");
            if (v["url"].Trim().Length > 0) await Check();
        }

        Task Check() => C.Run(async () =>
        {
            var r = await C.Api.PostJ(C.St("/podcast/check"), null, 30);
            C.Status((J.Bool(r, "ok") ? "✓ " : "✗ ") + J.Str(r, "message"), !J.Bool(r, "ok"));
        }, "Prüfung");

        async Task Host()
        {
            var host = J.Get(overview, "host");
            var kind = J.Str(host, "kind", "buzzsprout");
            var v = Dlg.Form(C.Owner, "Podcast-Hoster", "Speichern",
                Field.Choice("kind", "Hoster", kind, ("buzzsprout", "Buzzsprout"), ("podbean", "Podbean"), ("", "Keinen (entfernen)")),
                Field.Text("podcastId", "Buzzsprout-Podcast-ID (Ziffern)", J.Str(host, "podcastId")),
                Field.Password("token", "Buzzsprout-API-Token", "Leer lassen = gespeicherten behalten. Buzzsprout → Profil → API"),
                Field.Text("clientId", "Podbean Client-ID", ""), Field.Password("clientSecret", "Podbean Client-Secret", "Leer lassen = gespeicherte behalten"),
                Field.Text("feedUrl", "Podbean-Feed-Adresse (optional)", kind == "podbean" ? J.Str(host, "feedUrl") : ""),
                Field.Check("autoPush", "Neue, automatisch veröffentlichte Episoden sofort hochladen", J.Bool(host, "autoPush")));
            if (v == null) return;
            await C.Run(async () =>
            {
                await C.Api.PutJ(C.St("/podcast/host"), new { kind = v["kind"], podcastId = v["podcastId"].Trim(), token = v["token"], clientId = v["clientId"].Trim(), clientSecret = v["clientSecret"], feedUrl = v["feedUrl"].Trim(), autoPush = v["autoPush"] == "true" });
                await Load();
            }, "Hoster");
            if (v["kind"].Length > 0) await TestHost();
        }

        Task TestHost() => C.Run(async () => { var r = await C.Api.PostJ(C.St("/podcast/host/test"), null, 40); C.Ok("✓ " + J.Str(r, "message")); }, "Hoster");

        async Task TogglePublished()
        {
            var r = episodes.One;
            if (r == null) return;
            var published = J.Long(r.El, "publishedAt") > 0;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/podcast/episodes/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { published = !published }); await Load(); }, "Episode");
        }

        async Task EditEpisode()
        {
            var r = episodes.One;
            if (r == null) return;
            var e = r.El;
            var v = Dlg.Form(C.Owner, "Episode bearbeiten", "Speichern", Field.Text("title", "Titel", J.Str(e, "title")), Field.Multi("description", "Shownotes", J.Str(e, "description")),
                Field.Text("season", "Staffel (optional)", J.Str(e, "season")), Field.Text("number", "Episodennummer (optional)", J.Str(e, "episodeNumber")));
            if (v == null) return;
            object Num(string s) => int.TryParse(s, out var n) && n > 0 ? (object)n : null;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/podcast/episodes/" + Uri.EscapeDataString(J.Str(e, "id"))), new { title = v["title"], description = v["description"], season = Num(v["season"]), episodeNumber = Num(v["number"]) }); await Load(); }, "Episode");
        }

        async Task Push()
        {
            var r = episodes.One;
            if (r == null) return;
            C.Status("Lade „" + J.Str(r.El, "title") + "“ zum Hoster hoch – das kann einige Minuten dauern …", false);
            await C.Run(async () => { await C.Api.PostJ(C.St("/podcast/episodes/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/push"), null, 1800); await Load(); C.Ok("Beim Hoster angelegt"); }, "Hoster");
        }

        async Task Delete()
        {
            var r = episodes.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Episode „" + J.Str(r.El, "title") + "“ löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/podcast/episodes/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); }, "Episode");
        }
    }

    static class ServerBody
    {
        /// <summary>Anonyme Objekte mit "explicit_" (Schlüsselwort in C#) für den Server umbenennen: explicit_ → explicit.</summary>
        public static object ToServer(this object o)
        {
            var json = JsonSerializer.Serialize(o).Replace("\"explicit_\":", "\"explicit\":");
            using (var doc = JsonDocument.Parse(json)) return doc.RootElement.Clone();
        }
    }
}
