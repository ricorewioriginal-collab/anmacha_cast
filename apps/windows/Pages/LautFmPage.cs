// laut.fm verwalten: Anbindung (Token, Station) und die vollständige Playlist-Verwaltung direkt bei laut.fm über die
// Radioadmin-API – Playlists anlegen, bearbeiten, kopieren, leeren, löschen; Titel suchen und (mehrere auf einmal)
// hinzufügen, MP3s direkt in eine Playlist hochladen, Titel entfernen, kopieren oder verschieben. Alle Aufrufe laufen
// über den Server mit dem gespeicherten Token (Wiederholung bei Last, Origin-Neuermittlung, verständliche Fehler:
// src/server/lautfm.ts). Mehrfachauswahl in den Tabellen mit Strg/Umschalt wie im Explorer.
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
    sealed class LautFmPage : View
    {
        readonly TextBlock status = Kit.Text("", 13, false, Kit.Fg, true);
        readonly TextBlock facts = Kit.Hint("");
        readonly Table playlists = new Table(("Playlist", 230), ("Titel", 60), ("Dauer", 80), ("Reihenfolge", 100));
        readonly Table tracks = new Table(("Interpret", 200), ("Titel", 240), ("Genre", 110), ("Dauer", 70), ("ID", 80));
        readonly TextBlock plHead = Kit.Text("Playlist wählen", 14, true);
        readonly TextBlock plInfo = Kit.Hint("Links eine Playlist anklicken. Mehrere Titel mit Strg/Umschalt auswählen.");
        JsonElement cfg;
        string ra = "";
        long openId;

        public override string Title => "laut.fm verwalten";

        public LautFmPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Children.Add(Kit.Card("Anbindung", Kit.V(status, facts, Kit.Wrap(
                Kit.Btn("Token eintragen / verbinden …", Connect, "Radioadmin-Token von laut.fm", true), Kit.Btn("Prüfen", Check), Kit.Btn("Station wählen …", PickStation, "Welche laut.fm-Station dieser Sender ist"),
                Kit.Btn("laut.fm-Anmeldeseite öffnen", OpenLogin), Kit.Btn("Neu laden", () => Show()))),
                "Der Server speichert das Token verschlüsselt und nutzt es für Playlists, Sendeplan und Live-Zugang."));

            var lower = new Grid();
            // Playlists schmaler, Titel breiter – passt auch bei kleinen Fenstern
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star), MinWidth = 300 });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
            playlists.SelectionMode = SelectionMode.Single;
            playlists.SelectionChanged += async (s, e) => { if (playlists.One != null) await OpenPlaylist(playlists.One.El); };
            lower.Children.Add(Kit.Card("Playlists bei laut.fm", Kit.V(
                Kit.Wrap(Kit.Btn("＋ Neue Playlist", NewPlaylist, null, true), Kit.Btn("Bearbeiten", EditPlaylist), Kit.Btn("Kopieren", CopyPlaylist), Kit.Btn("Leeren", ClearPlaylist), Kit.Btn("Löschen", DeletePlaylist)),
                playlists)));
            var right = Kit.Card("Titel", Kit.V(plHead, plInfo,
                Kit.Wrap(Kit.Btn("＋ Titel suchen & hinzufügen …", AddBySearch, "Titel bei laut.fm suchen und angekreuzt hinzufügen", true), Kit.Btn("⭱ MP3 hochladen …", Upload, "MP3-Dateien direkt in diese Playlist laden"),
                    Kit.Btn("Auswahl entfernen", RemoveSelected), Kit.Btn("In Playlist kopieren …", () => CopySelected(false)), Kit.Btn("Verschieben …", () => CopySelected(true))),
                tracks));
            right.Margin = new Thickness(10, 0, 0, 10);
            Grid.SetColumn(right, 1);
            lower.Children.Add(right);
            SetRow(lower, 1);
            Children.Add(lower);
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                cfg = await C.Api.GetJ(C.St("/lautfm"));
                var has = J.Bool(cfg, "hasToken");
                var sid = J.Str(cfg, "stationId");
                var sname = J.Str(cfg, "stationName");
                status.Text = has ? "Verbunden" + (sid.Length > 0 ? " · laut.fm-Station " + (sname.Length > 0 ? sname + " (" + sid + ")" : sid) : " – noch keine laut.fm-Station gewählt: „Station wählen …“") : "Nicht verbunden – Token eintragen.";
                playlists.Set(new Row[0]);
                tracks.Set(new Row[0]);
                facts.Text = "";
                if (!has || sid.Length == 0) { ra = ""; return; }
                ra = C.St("/lautfm/ra/stations/" + Uri.EscapeDataString(sid));
                var info = C.Api.GetJ(ra, 40);
                var stats = C.Api.GetJ(ra + "/stats", 40);
                await LoadPlaylists();
                try { await Task.WhenAll(info, stats); } catch (ApiException) { }
                var parts = new List<string>();
                if (info.Status == TaskStatus.RanToCompletion) { parts.Add(J.Str(info.Result, "name")); parts.Add(J.Str(info.Result, "format")); parts.Add(string.Join(", ", J.Strings(info.Result, "genres"))); }
                if (stats.Status == TaskStatus.RanToCompletion) parts.Add("Hörer jetzt: " + J.Str(stats.Result, "listeners_now", "–"));
                facts.Text = string.Join(" · ", parts.Where(x => x.Length > 0));
            }, "laut.fm");
        }

        async Task LoadPlaylists()
        {
            var pl = await C.Api.GetJ(ra + "/playlists", 40);
            var rows = J.Arr(pl, "playlists").Select(p => new Row(p, J.Str(p, "title"), J.Str(p, "size", "0"), Fmt.Dur(J.Long(p, "duration") * 1000), J.Bool(p, "shuffled") ? "gemischt" : "fest")).ToList();
            playlists.Set(rows);
            var again = rows.FirstOrDefault(r => J.Long(r.El, "id") == openId);
            if (again != null) playlists.SelectedItem = again;
        }

        List<JsonElement> AllPlaylists() => (playlists.ItemsSource as IEnumerable<Row> ?? new Row[0]).Select(r => r.El).ToList();

        async Task OpenPlaylist(JsonElement p)
        {
            openId = J.Long(p, "id");
            plHead.Text = "Playlist: " + J.Str(p, "title");
            await C.Run(async () =>
            {
                var list = await AllTracks(openId);
                tracks.Set(list.Select(TrackRow));
                plInfo.Text = list.Count + " Titel · " + Fmt.Dur(list.Sum(t => J.Long(t, "duration")) * 1000) + " · " + (J.Bool(p, "shuffled") ? "gemischt" : "feste Reihenfolge");
            }, "laut.fm");
        }

        static Row TrackRow(JsonElement t)
        {
            var artist = t.TryGetProperty("artist", out var a) && a.ValueKind == JsonValueKind.Object ? J.Str(a, "name") : J.Str(t, "artist");
            return new Row(t, artist, J.Str(t, "title"), J.Str(t, "genre"), Fmt.Dur(J.Long(t, "duration") * 1000), J.Str(t, "id"));
        }

        /// <summary>Alle Seiten der Playlist-Titel (laut.fm: _paging.total_pages/current_page).</summary>
        async Task<List<JsonElement>> AllTracks(long pid)
        {
            var all = new List<JsonElement>();
            for (var page = 1; page <= 200; page++)
            {
                var r = await C.Api.GetJ(ra + "/playlists/" + pid + "/tracks?page=" + page, 40);
                all.AddRange(J.Arr(r, "tracks"));
                var paging = r.TryGetProperty("_paging", out var pg) ? pg : default;
                var total = paging.ValueKind == JsonValueKind.Object ? J.Long(paging, "total_pages") : 1;
                if (page >= total) break;
            }
            return all;
        }

        /// <summary>Titel anhängen; laut.fm lehnt Titel ab, die schon drin sind (zählt als „schon vorhanden“).</summary>
        async Task<(int Added, int Skipped)> Append(long pid, IList<long> ids)
        {
            int added = 0, skipped = 0;
            for (var i = 0; i < ids.Count; i++)
            {
                C.Status("Füge hinzu … " + (i + 1) + "/" + ids.Count, false);
                try { await C.Api.PostJ(ra + "/playlists/" + pid, new { track_id = ids[i] }, 40); added++; }
                catch (ApiException) { skipped++; }
            }
            return (added, skipped);
        }

        async Task Remove(long pid, IList<long> ids)
        {
            var list = ids.Distinct().ToList();
            for (var i = 0; i < list.Count; i++)
            {
                C.Status("Entferne … " + (i + 1) + "/" + list.Count, false);
                await C.Api.DeleteJ(ra + "/playlists/" + pid + "/entries/" + list[i], null, 40);
            }
        }

        long? PickPlaylist(string title)
        {
            var others = AllPlaylists().Where(p => J.Long(p, "id") != openId).Select(p => (J.Str(p, "id"), J.Str(p, "title"))).ToList();
            if (others.Count == 0) { C.Status("Keine andere Playlist vorhanden", true); return null; }
            var id = Dlg.Pick(C.Owner, title, others);
            return id == null ? (long?)null : long.Parse(id);
        }

        bool Ready()
        {
            if (ra.Length == 0) { C.Status("Zuerst mit laut.fm verbinden und die Station wählen", true); return false; }
            return true;
        }

        bool PlaylistOpen()
        {
            if (!Ready()) return false;
            if (openId == 0) { C.Status("Bitte links eine Playlist wählen", true); return false; }
            return true;
        }

        JsonElement Current() => AllPlaylists().FirstOrDefault(p => J.Long(p, "id") == openId);

        // ---------- Playlists ----------

        async Task NewPlaylist()
        {
            if (!Ready()) return;
            var v = Dlg.Form(C.Owner, "Neue laut.fm-Playlist", "Anlegen",
                Field.Text("title", "Name"), Field.Text("color", "Farbe (#rrggbb)", "#19c3e6"), Field.Text("description", "Beschreibung"), Field.Check("shuffled", "Gemischt abspielen", true));
            if (v == null || v["title"].Trim().Length == 0) return;
            await C.Run(async () =>
            {
                var r = await C.Api.PostJ(ra + "/playlists", new { title = v["title"].Trim(), color = ColorOr(v["color"]), description = v["description"], shuffled = v["shuffled"] == "true" }, 40);
                if (r.ValueKind == JsonValueKind.Object && J.Long(r, "id") != 0) openId = J.Long(r, "id");
                C.Ok("Playlist angelegt");
                await LoadPlaylists();
            }, "laut.fm");
        }

        static string ColorOr(string c) => System.Text.RegularExpressions.Regex.IsMatch(c ?? "", "^#[0-9a-fA-F]{6}$") ? c : "#19c3e6";

        async Task EditPlaylist()
        {
            if (!PlaylistOpen()) return;
            var p = Current();
            var v = Dlg.Form(C.Owner, "Playlist bearbeiten", "Speichern",
                Field.Text("title", "Name", J.Str(p, "title")), Field.Text("color", "Farbe (#rrggbb)", J.Str(p, "color")), Field.Text("description", "Beschreibung", J.Str(p, "description")),
                Field.Check("shuffled", "Gemischt abspielen", J.Bool(p, "shuffled")));
            if (v == null) return;
            await C.Run(async () =>
            {
                await C.Api.PatchJ(ra + "/playlists/" + openId, new { title = v["title"].Trim(), color = ColorOr(v["color"]), description = v["description"], shuffled = v["shuffled"] == "true" }, 40);
                C.Ok("Playlist gespeichert");
                await LoadPlaylists();
            }, "laut.fm");
        }

        async Task CopyPlaylist()
        {
            if (!PlaylistOpen()) return;
            var p = Current();
            var v = Dlg.Form(C.Owner, "Playlist kopieren", "Kopieren", Field.Text("title", "Name der Kopie", J.Str(p, "title") + " (Kopie)"));
            if (v == null || v["title"].Trim().Length == 0) return;
            await C.Run(async () =>
            {
                var title = v["title"].Trim();
                var ids = (await AllTracks(openId)).Select(t => J.Long(t, "id")).ToList();
                var r = await C.Api.PostJ(ra + "/playlists", new { title, color = ColorOr(J.Str(p, "color")), description = J.Str(p, "description"), shuffled = J.Bool(p, "shuffled") }, 40);
                var id = r.ValueKind == JsonValueKind.Object ? J.Long(r, "id") : 0;
                if (id == 0)
                {
                    await LoadPlaylists();
                    id = AllPlaylists().Where(x => J.Str(x, "title") == title).Select(x => J.Long(x, "id")).FirstOrDefault();
                }
                if (id == 0) throw new InvalidOperationException("Neue Playlist wurde bei laut.fm nicht gefunden");
                var res = await Append(id, ids);
                openId = id;
                C.Ok("„" + title + "“ angelegt mit " + res.Added + " Titeln");
                await LoadPlaylists();
            }, "laut.fm");
        }

        async Task ClearPlaylist()
        {
            if (!PlaylistOpen()) return;
            var p = Current();
            if (!Dlg.Confirm(C.Owner, "Alle Titel aus „" + J.Str(p, "title") + "“ entfernen? Die Playlist bleibt bestehen, die Titel selbst bleiben bei laut.fm.")) return;
            await C.Run(async () =>
            {
                await Remove(openId, (await AllTracks(openId)).Select(t => J.Long(t, "id")).ToList());
                C.Ok("Playlist geleert");
                await LoadPlaylists();
            }, "laut.fm");
        }

        async Task DeletePlaylist()
        {
            if (!PlaylistOpen()) return;
            var p = Current();
            if (!Dlg.Confirm(C.Owner, "Playlist „" + J.Str(p, "title") + "“ bei laut.fm löschen?")) return;
            await C.Run(async () =>
            {
                await C.Api.DeleteJ(ra + "/playlists/" + openId, null, 40);
                openId = 0;
                plHead.Text = "Playlist wählen";
                tracks.Set(new Row[0]);
                C.Ok("Playlist gelöscht");
                await LoadPlaylists();
            }, "laut.fm");
        }

        // ---------- Titel ----------

        List<long> SelectedIds() => tracks.Many.Select(r => J.Long(r.El, "id")).Where(id => id != 0).ToList();

        async Task RemoveSelected()
        {
            if (!PlaylistOpen()) return;
            var ids = SelectedIds();
            if (ids.Count == 0) { C.Status("Bitte Titel auswählen (Strg/Umschalt für mehrere)", true); return; }
            if (!Dlg.Confirm(C.Owner, ids.Count + " Titel aus der Playlist entfernen? Die Titel selbst bleiben bei laut.fm.")) return;
            await C.Run(async () => { await Remove(openId, ids); C.Ok(ids.Count + " Titel entfernt"); await LoadPlaylists(); }, "laut.fm");
        }

        async Task CopySelected(bool move)
        {
            if (!PlaylistOpen()) return;
            var ids = SelectedIds();
            if (ids.Count == 0) { C.Status("Bitte Titel auswählen (Strg/Umschalt für mehrere)", true); return; }
            var target = PickPlaylist(move ? "In welche Playlist verschieben?" : "In welche Playlist kopieren?");
            if (target == null) return;
            await C.Run(async () =>
            {
                var r = await Append(target.Value, ids);
                if (move) await Remove(openId, ids);
                C.Ok((move ? ids.Count + " verschoben" : r.Added + " kopiert") + (r.Skipped > 0 ? " (" + r.Skipped + " waren schon drin)" : ""));
                await LoadPlaylists();
            }, "laut.fm");
        }

        /// <summary>Suchfenster: Interpret/Titel/Genre, Treffer mehrfach auswählen und gesammelt hinzufügen.</summary>
        async Task AddBySearch()
        {
            if (!PlaylistOpen()) return;
            var pid = openId;
            var w = Dlg.Make(C.Owner, "Titel suchen – " + J.Str(Current(), "title"), 820);
            w.SizeToContent = SizeToContent.Manual;
            w.Height = 560;
            w.ResizeMode = ResizeMode.CanResize;
            var artist = Kit.Box("", 180);
            var title = Kit.Box("", 180);
            var genre = Kit.Box("", 120);
            var own = new CheckBox { Content = "nur eigene", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 8, 0) };
            var hits = new Table(("Interpret", 220), ("Titel", 260), ("Genre", 110), ("Dauer", 70), ("ID", 80));
            var info = Kit.Hint("Suchen, dann Titel markieren (Strg/Umschalt für mehrere) und „Hinzufügen“.");
            var added = 0;
            async Task Search()
            {
                var q = new List<string>();
                if (artist.Text.Trim().Length > 0) q.Add("artist=" + Uri.EscapeDataString(artist.Text.Trim()));
                if (title.Text.Trim().Length > 0) q.Add("title=" + Uri.EscapeDataString(title.Text.Trim()));
                if (genre.Text.Trim().Length > 0) q.Add("genre=" + Uri.EscapeDataString(genre.Text.Trim()));
                if (own.IsChecked == true) q.Add("own=true");
                if (q.Count == 0 || (q.Count == 1 && own.IsChecked == true)) { info.Text = "Bitte Interpret, Titel oder Genre eingeben."; return; }
                await C.Run(async () =>
                {
                    var r = await C.Api.GetJ(ra + "/tracks?" + string.Join("&", q), 40);
                    var list = J.Arr(r, "tracks").ToList();
                    hits.Set(list.Select(TrackRow));
                    info.Text = list.Count + " Treffer";
                }, "laut.fm");
            }
            async Task Add()
            {
                var ids = hits.Many.Select(x => J.Long(x.El, "id")).Where(id => id != 0).ToList();
                if (ids.Count == 0) { info.Text = "Bitte Titel markieren."; return; }
                await C.Run(async () =>
                {
                    var r = await Append(pid, ids);
                    added += r.Added;
                    info.Text = r.Added + " hinzugefügt" + (r.Skipped > 0 ? ", " + r.Skipped + " waren schon drin" : "");
                    C.Ok(info.Text);
                }, "laut.fm");
            }
            var search = Kit.Btn("Suchen", Search, null, true);
            search.IsDefault = true;
            var add = Kit.Btn("Markierte hinzufügen", Add);
            var done = Kit.Btn("Fertig", () => w.Close());
            hits.MouseDoubleClick += async (s, e) => await Add();
            var grid = new Grid { Margin = new Thickness(14) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.Children.Add(Kit.Wrap(Kit.Text("Interpret"), artist, Kit.Text("Titel"), title, Kit.Text("Genre"), genre, own, search));
            Grid.SetRow(info, 1);
            info.Margin = new Thickness(0, 8, 0, 8);
            grid.Children.Add(info);
            Grid.SetRow(hits, 2);
            grid.Children.Add(hits);
            var buttons = Kit.H(add, done);
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Margin = new Thickness(0, 10, 0, 0);
            Grid.SetRow(buttons, 3);
            grid.Children.Add(buttons);
            w.Content = grid;
            w.Loaded += (s, e) => artist.Focus();
            w.ShowDialog();
            if (added > 0) await C.Run(LoadPlaylists, "laut.fm");
        }

        /// <summary>MP3s direkt in die geöffnete Playlist hochladen: Upload (negative ID), auf Verarbeitung warten, Metadaten setzen, anhängen.</summary>
        async Task Upload()
        {
            if (!PlaylistOpen()) return;
            var pid = openId;
            var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "MP3 (*.mp3)|*.mp3", Multiselect = true, Title = "MP3s zu laut.fm hochladen" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var ok = 0;
            foreach (var file in dlg.FileNames)
            {
                var name = System.IO.Path.GetFileNameWithoutExtension(file);
                var dash = name.IndexOf(" - ", StringComparison.Ordinal);
                var v = Dlg.Form(C.Owner, "Hochladen: " + System.IO.Path.GetFileName(file), "Hochladen",
                    Field.Text("artist", "Interpret", dash > 0 ? name.Substring(0, dash).Trim() : ""), Field.Text("title", "Titel", dash > 0 ? name.Substring(dash + 3).Trim() : name),
                    Field.Choice("type", "Typ", "song", ("song", "Song"), ("jingle", "Jingle")), Field.Check("private", "Privat (nicht in der öffentlichen laut.fm-Songdatenbank)", false));
                if (v == null) continue;
                if (await C.Run(() => UploadOne(file, v, pid), "laut.fm-Upload")) ok++;
            }
            C.Status(ok + "/" + dlg.FileNames.Length + " Datei(en) an laut.fm übertragen", ok < dlg.FileNames.Length);
            await C.Run(LoadPlaylists, "laut.fm");
        }

        async Task UploadOne(string file, Dictionary<string, string> meta, long pid)
        {
            C.Status("laut.fm-Upload: " + System.IO.Path.GetFileName(file) + " …", false);
            var snap = await C.Api.GetJ(ra + "/tracks?own=true&order=desc", 40);
            var snapshotId = J.Arr(snap, "tracks").Select(t => J.Long(t, "id")).DefaultIfEmpty(0).First();
            var up = await C.Api.PostMultipart(ra + "/tracks", "track", file, new Dictionary<string, string> { ["private"] = meta["private"] == "true" ? "true" : "false" });
            if (up.ValueKind != JsonValueKind.Object || !up.TryGetProperty("id", out _)) throw new InvalidOperationException("Upload fehlgeschlagen");
            // laut.fm verarbeitet die Datei erst (negative ID); danach erscheint sie mit echter ID unter den eigenen Titeln
            long trackId = 0;
            var until = DateTime.UtcNow.AddSeconds(120);
            while (DateTime.UtcNow < until)
            {
                await Task.Delay(3000);
                C.Status("Warte auf laut.fm-Verarbeitung …", false);
                var own = await C.Api.GetJ(ra + "/tracks?own=true&order=desc", 40);
                var newest = J.Arr(own, "tracks").Select(t => J.Long(t, "id")).DefaultIfEmpty(0).First();
                if (newest > snapshotId) { trackId = newest; break; }
            }
            if (trackId == 0) { C.Status(System.IO.Path.GetFileName(file) + ": hochgeladen, laut.fm verarbeitet noch – später unter „Titel suchen“ (nur eigene) hinzufügen", true); return; }
            // nur ausgefüllte Felder senden (leer = laut.fm-Erkennung aus der Datei behalten)
            var patch = new Dictionary<string, object> { ["type"] = meta["type"], ["private"] = meta["private"] == "true" };
            if (meta["artist"].Trim().Length > 0) patch["artist"] = meta["artist"].Trim();
            if (meta["title"].Trim().Length > 0) patch["title"] = meta["title"].Trim();
            try { await C.Api.PatchJ(ra + "/tracks/" + trackId, patch, 40); } catch (ApiException) { }
            await Append(pid, new List<long> { trackId });
        }

        // ---------- Anbindung ----------

        async Task Connect()
        {
            var v = Dlg.Form(C.Owner, "Mit laut.fm verbinden", "Verbinden",
                Field.Info("So geht's", "Auf laut.fm im Radioadmin anmelden; das Token wird bei der Anmeldung an die Adresse zurückgegeben (…#lautfm_radioadmin_token=…). Hier einfügen."),
                Field.Password("token", "Radioadmin-Token"));
            if (v == null || v["token"].Trim().Length == 0) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/lautfm/connect"), new { token = v["token"].Trim() }, 60); C.Ok("Mit laut.fm verbunden"); await Show(); }, "laut.fm");
        }

        Task Check() => C.Run(async () =>
        {
            var r = await C.Api.PostJ(C.St("/lautfm/check"), null, 40);
            if (J.Bool(r, "ok")) C.Ok("laut.fm: Verbindung in Ordnung · " + J.Arr(r, "stations").Count() + " Station(en) im Konto");
            else C.Status("laut.fm: " + J.Str(r, "message", "Verbindung nicht in Ordnung"), true);
        }, "laut.fm");

        /// <summary>laut.fm-Station dieses Senders wählen (Liste aus dem Konto des Tokens).</summary>
        Task PickStation() => C.Run(async () =>
        {
            var r = await C.Api.PostJ(C.St("/lautfm/check"), null, 40);
            if (!J.Bool(r, "ok")) { C.Status("laut.fm: " + J.Str(r, "message", "erst verbinden"), true); return; }
            var list = J.Arr(r, "stations").ToList();
            var id = Dlg.Pick(C.Owner, "laut.fm-Station für diesen Sender", list.Select(s => (J.Str(s, "id"), J.Str(s, "displayName", J.Str(s, "name")) + " · " + J.Str(s, "role"))).ToList());
            if (id == null) return;
            var pick = list.First(s => J.Str(s, "id") == id);
            await C.Api.PutJ(C.St("/lautfm"), new { stationId = long.Parse(id), stationName = J.Str(pick, "name") });
            C.Ok("laut.fm-Station gewählt");
            await Show();
        }, "laut.fm");

        void OpenLogin()
        {
            var url = J.Str(cfg, "loginUrl");
            if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
}
