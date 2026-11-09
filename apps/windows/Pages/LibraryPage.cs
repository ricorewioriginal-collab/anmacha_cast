// Mediathek: suchen, hochladen, vorhören, in die Warteschlange oder auf ein Deck legen; rechts Cover und alle Angaben des
// markierten Titels mit Bearbeiten (Titel, Interpret, Album, Genre, Jahr, BPM, Ordner, Tags), eigenem Cover und Online-Suche
// (iTunes/MusicBrainz über den Server, Cover wird übernommen).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class LibraryPage : View
    {
        public static readonly (string, string)[] Categories =
        {
            ("music", "Musik"), ("jingle", "Jingle"), ("sweeper", "Sweeper"), ("station_id", "Senderkennung"), ("drop", "Drop"), ("news", "Nachrichten"),
            ("ad", "Werbung"), ("voice_track", "Voice-Track"), ("tts", "KI-Sprache"), ("bed", "Musikbett"), ("stream", "Stream"),
        };

        readonly Table table = new Table(("Titel", 270), ("Interpret", 190), ("Art", 110), ("Dauer", 60), ("Tags", 160));
        readonly TextBox search = Kit.Box("", 260);
        readonly ComboBox category = new ComboBox { Margin = new Thickness(3), MinWidth = 140 };
        readonly TextBlock count = Kit.Text("", 12, false, Kit.Muted);
        List<JsonElement> all = new List<JsonElement>();
        MediaPlayer player;
        string playingId;

        // Detailbereich rechts: Cover groß, Angaben, Aktionen. Cover werden nur für den markierten Titel geladen (spart Last)
        readonly Image cover = new Image { Width = 220, Height = 220, Stretch = Stretch.UniformToFill };
        readonly TextBlock coverLetter = new TextBlock { FontSize = 64, FontWeight = FontWeights.Black, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock dTitle = Kit.Text("Kein Titel markiert", 15, true, null, true);
        readonly TextBlock dArtist = Kit.Text("", 13, false, Kit.Muted, true);
        readonly StackPanel dFacts = new StackPanel();
        readonly Dictionary<string, ImageSource> covers = new Dictionary<string, ImageSource>();
        readonly HashSet<string> noCover = new HashSet<string>();
        string shownId;

        public override string Title => "Mediathek";

        public LibraryPage(Ctx c) : base(c)
        {
            category.Items.Add("Alle Arten");
            foreach (var cat in Categories) category.Items.Add(cat.Item2);
            category.SelectedIndex = 0;
            category.SelectionChanged += (s, e) => Filter();
            search.TextChanged += (s, e) => Filter();
            search.ToolTip = "Suchen in Titel, Interpret und Tags";

            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var bar = Kit.Wrap(
                Kit.Text("Suchen:", 13, false, Kit.Muted), search, category,
                Kit.Btn("Hochladen …", Upload, "Audiodateien (MP3, WAV, FLAC, OGG, M4A …) in die Mediathek laden", true),
                Kit.Btn("Neu laden", Load));
            Children.Add(bar);

            table.MouseDoubleClick += async (s, e) => await Preview();
            table.SelectionChanged += async (s, e) => await ShowDetails();
            var body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(260) });
            body.Children.Add(table);
            var art = new Border
            {
                Width = 220, Height = 220, CornerRadius = new CornerRadius(14), ClipToBounds = true, HorizontalAlignment = HorizontalAlignment.Left,
                Background = Theme.Linear(135, (Theme.C("#1E3A5F"), 0), (Theme.C("#2B2F6B"), 1)), Child = new Grid { Children = { coverLetter, cover } },
            };
            art.Loaded += (s, e) => art.Clip = new RectangleGeometry(new Rect(0, 0, 220, 220), 14, 14);
            var detail = Kit.Card("Titel", Kit.Scroll(Kit.V(art, dTitle, dArtist, dFacts,
                Kit.Wrap(Kit.Btn("Bearbeiten …", Edit, "Titel, Interpret, Album, Genre, Jahr, BPM, Ordner, Tags", true), Kit.Btn("Online suchen …", Lookup, "Angaben und Cover bei iTunes/MusicBrainz suchen")),
                Kit.Wrap(Kit.Btn("Cover ändern …", ChangeCover, "Eigenes Bild (JPEG, PNG, WebP)"), Kit.Btn("Cover entfernen", RemoveCover)))));
            dTitle.Margin = new Thickness(0, 10, 0, 2);
            detail.Margin = new Thickness(10, 0, 0, 0);
            Grid.SetColumn(detail, 1);
            body.Children.Add(detail);
            SetRow(body, 1);
            Children.Add(body);

            var deckMenu = new ContextMenu();
            foreach (var d in new[] { "A", "B", "C", "D" })
            {
                var id = d;
                var mi = new MenuItem { Header = "Deck " + d };
                mi.Click += async (s, e) => await ToDeck(id);
                deckMenu.Items.Add(mi);
            }
            var deckBtn = Kit.Btn("Auf Deck ▾", () => { }, "Gewählten Titel auf ein Deck laden");
            deckBtn.ContextMenu = deckMenu;
            deckBtn.Click += (s, e) => { deckMenu.PlacementTarget = deckBtn; deckMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom; deckMenu.IsOpen = true; };

            var actions = Kit.Wrap(count,
                Kit.Btn("Vorhören", Preview, "Titel herunterladen und hier abspielen (Doppelklick)"),
                Kit.Btn("In die Warteschlange", Enqueue), deckBtn,
                Kit.Btn("Bearbeiten …", Edit), Kit.Btn("Löschen", Delete));
            SetRow(actions, 2);
            Children.Add(actions);
        }

        public override Task Show() => Load();

        public override void OnEvent(string type) { if (type == "library.changed" && IsVisible) _ = Load(); }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            var keep = shownId;
            await C.Run(async () =>
            {
                all = J.Arr(await C.Api.GetJ(C.St("/media"))).ToList();
                Filter();
                var again = keep == null ? null : (table.ItemsSource as IEnumerable<Row>)?.FirstOrDefault(r => J.Str(r.El, "id") == keep);
                if (again != null) { table.SelectedItem = again; table.ScrollIntoView(again); }
            }, "Mediathek");
        }

        void Filter()
        {
            var q = search.Text.Trim().ToLowerInvariant();
            var cat = category.SelectedIndex > 0 ? Categories[category.SelectedIndex - 1].Item1 : null;
            var rows = all.Where(m => (cat == null || J.Str(m, "category") == cat)
                    && (q.Length == 0 || (J.Str(m, "title") + " " + J.Str(m, "artist") + " " + string.Join(" ", J.Strings(m, "tags"))).ToLowerInvariant().Contains(q)))
                .OrderBy(m => J.Str(m, "artist").ToLowerInvariant()).ThenBy(m => J.Str(m, "title").ToLowerInvariant()).ToList();
            table.Set(rows.Take(2000).Select(m => new Row(m, J.Str(m, "title"), J.Str(m, "artist"), CategoryLabel(J.Str(m, "category")),
                Fmt.Dur(J.Ok(J.Get(m, "durationMs")) ? J.Long(m, "durationMs") : (long?)null), string.Join(", ", J.Strings(m, "tags")))));
            count.Text = rows.Count + " von " + all.Count + " Titeln   ";
        }

        static string CategoryLabel(string id) => Categories.FirstOrDefault(c => c.Item1 == id).Item2 ?? id;

        // ---------- Aktionen ----------

        async Task Upload()
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Multiselect = true, Title = "Audiodateien hochladen", Filter = "Audio|*.mp3;*.wav;*.flac;*.ogg;*.opus;*.m4a;*.aac;*.webm|Alle Dateien|*.*" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var v = Dlg.Form(C.Owner, "Hochladen", "Hochladen", Field.Info("Dateien", dlg.FileNames.Length + " Datei(en)"), Field.Choice("cat", "Art der Titel", "music", Categories));
            if (v == null) return;
            var done = 0;
            foreach (var file in dlg.FileNames)
            {
                C.Status("Lade hoch (" + (done + 1) + "/" + dlg.FileNames.Length + "): " + Path.GetFileName(file) + " …", false);
                var ok = await C.Run(() => C.Api.UploadFile(C.St("/media?name=" + Uri.EscapeDataString(Path.GetFileName(file)) + "&category=" + Uri.EscapeDataString(v["cat"])), file), Path.GetFileName(file));
                if (!ok) return;
                done++;
            }
            C.Ok(done + " Datei(en) hochgeladen");
            await Load();
        }

        async Task Enqueue()
        {
            var rows = table.Many.ToList();
            if (rows.Count == 0) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.PostJ(C.St("/queue"), new { mediaId = J.Str(r.El, "id") }); C.Ok(rows.Count + " Titel eingereiht"); }, "Warteschlange");
        }

        async Task ToDeck(string deck)
        {
            var r = table.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.DeckAction(C.StationId, deck, "load", new { mediaId = J.Str(r.El, "id") }); C.Ok("Auf Deck " + deck + " geladen: " + J.Str(r.El, "title")); }, "Deck " + deck);
        }

        JsonElement? Selected()
        {
            var r = table.One;
            if (r == null) { C.Status("Bitte zuerst einen Titel in der Liste markieren", true); return null; }
            return r.El;
        }

        async Task Edit()
        {
            if (!(Selected() is JsonElement m)) return;
            var v = Dlg.Form(C.Owner, "Titel bearbeiten", "Speichern",
                Field.Text("title", "Titel", J.Str(m, "title")), Field.Text("artist", "Interpret", J.Str(m, "artist")),
                Field.Text("album", "Album", J.Str(m, "album")), Field.Text("genre", "Genre", J.Str(m, "genre")),
                Field.Text("year", "Jahr", J.Ok(J.Get(m, "year")) ? J.Str(m, "year") : ""), Field.Text("bpm", "BPM", J.Ok(J.Get(m, "bpm")) ? J.Num(m, "bpm").ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : ""),
                Field.Choice("category", "Art", J.Str(m, "category"), Categories),
                Field.Text("folder", "Ordner", J.Str(m, "folder")),
                Field.Text("tags", "Tags (mit Komma getrennt)", string.Join(", ", J.Strings(m, "tags"))));
            if (v == null) return;
            var tags = v["tags"].Split(',').Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToArray();
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            object year = int.TryParse(v["year"].Trim(), out var y) && y > 0 && y < 3000 ? (object)y : null;
            object bpm = double.TryParse(v["bpm"].Trim().Replace(',', '.'), System.Globalization.NumberStyles.Float, inv, out var b) && b > 0 ? (object)Math.Round(b, 1) : null;
            await C.Run(async () =>
            {
                await C.Api.PatchJ(C.St("/media/" + Uri.EscapeDataString(J.Str(m, "id"))), new
                {
                    title = v["title"].Trim(), artist = v["artist"].Trim(), album = v["album"].Trim(), genre = v["genre"].Trim(), year, bpm,
                    category = v["category"], folder = v["folder"].Trim(), tags,
                });
                await Load();
                C.Ok("Gespeichert");
            }, "Titel");
        }

        // ---------- Detailbereich, Cover, Online-Suche ----------

        async Task ShowDetails()
        {
            var r = table.One;
            if (r == null) { shownId = null; dTitle.Text = "Kein Titel markiert"; dArtist.Text = ""; dFacts.Children.Clear(); cover.Source = null; coverLetter.Text = ""; return; }
            var m = r.El;
            var id = J.Str(m, "id");
            shownId = id;
            dTitle.Text = J.Str(m, "title", id);
            dArtist.Text = J.Str(m, "artist");
            dFacts.Children.Clear();
            void Fact(string name, string value)
            {
                if (string.IsNullOrWhiteSpace(value)) return;
                var g = new Grid { Margin = new Thickness(0, 2, 0, 2) };
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var val = Kit.Text(value, 12.5, false, Kit.Fg, true);
                Grid.SetColumn(val, 1);
                g.Children.Add(Kit.Text(name, 12.5, false, Kit.Muted));
                g.Children.Add(val);
                dFacts.Children.Add(g);
            }
            Fact("Album", J.Str(m, "album") + (J.Ok(J.Get(m, "year")) ? " (" + J.Str(m, "year") + ")" : ""));
            Fact("Genre", J.Str(m, "genre"));
            Fact("Art", CategoryLabel(J.Str(m, "category")));
            Fact("Dauer", Fmt.Dur(J.Ok(J.Get(m, "durationMs")) ? J.Long(m, "durationMs") : (long?)null));
            Fact("BPM", J.Ok(J.Get(m, "bpm")) ? J.Num(m, "bpm").ToString("0.#") : "");
            Fact("Tonart", J.Str(m, "key") + (J.Str(m, "camelot").Length > 0 ? " · " + J.Str(m, "camelot") : ""));
            Fact("Lautheit", J.Ok(J.Get(m, "lufs")) ? J.Num(m, "lufs").ToString("0.0") + " LUFS" : "");
            Fact("Ordner", J.Str(m, "folder"));
            Fact("Tags", string.Join(", ", J.Strings(m, "tags")));
            var t = (J.Str(m, "artist").Length > 0 ? J.Str(m, "artist") : J.Str(m, "title")).Trim();
            coverLetter.Text = t.Length > 0 ? char.ToUpperInvariant(t[0]).ToString() : "♪";
            cover.Source = covers.TryGetValue(id, out var cached) ? cached : null;
            if (cached != null || noCover.Contains(id) || J.Str(m, "url").Length > 0) return;
            try
            {
                var data = await C.Api.Download(C.St("/media/" + Uri.EscapeDataString(id) + "/cover"));
                var img = new BitmapImage();
                img.BeginInit();
                img.CacheOption = BitmapCacheOption.OnLoad;
                img.DecodePixelWidth = 220;
                img.StreamSource = new MemoryStream(data);
                img.EndInit();
                img.Freeze();
                if (covers.Count > 300) covers.Clear();
                covers[id] = img;
                if (shownId == id) cover.Source = img;
            }
            catch (ApiException ex) when (ex.Status == 404) { noCover.Add(id); }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { /* Cover optional */ }
        }

        void ForgetCover(string id) { covers.Remove(id); noCover.Remove(id); }

        async Task ChangeCover()
        {
            if (!(Selected() is JsonElement m)) return;
            var dlg = new Microsoft.Win32.OpenFileDialog { Title = "Cover wählen", Filter = "Bilder|*.jpg;*.jpeg;*.png;*.webp" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var ext = Path.GetExtension(dlg.FileName).ToLowerInvariant();
            var type = ext == ".png" ? "image/png" : ext == ".webp" ? "image/webp" : "image/jpeg";
            if (new FileInfo(dlg.FileName).Length > 5 * 1024 * 1024) { C.Status("Das Bild ist größer als 5 MB", true); return; }
            var id = J.Str(m, "id");
            await C.Run(async () => { await C.Api.UploadFile(C.St("/media/" + Uri.EscapeDataString(id) + "/cover"), dlg.FileName, type); ForgetCover(id); await ShowDetails(); C.Ok("Cover gespeichert"); }, "Cover");
        }

        async Task RemoveCover()
        {
            if (!(Selected() is JsonElement m)) return;
            var id = J.Str(m, "id");
            if (!Dlg.Confirm(C.Owner, "Cover von „" + J.Str(m, "title") + "“ entfernen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/media/" + Uri.EscapeDataString(id) + "/cover")); ForgetCover(id); await ShowDetails(); C.Ok("Cover entfernt"); }, "Cover");
        }

        async Task Lookup()
        {
            if (!(Selected() is JsonElement m)) return;
            var id = J.Str(m, "id");
            await C.Run(async () =>
            {
                C.Status("Suche Angaben zu „" + J.Str(m, "title") + "“ …", false);
                var res = await C.Api.GetJ(C.St("/media/" + Uri.EscapeDataString(id) + "/lookup"), 30);
                var cands = J.Arr(res).ToList();
                if (cands.Count == 0) { C.Status("Nichts gefunden – Titel und Interpret prüfen", true); return; }
                var pick = Dlg.Pick(C.Owner, "Treffer übernehmen", cands.Select((c, i) => (i.ToString(), J.Str(c, "artist") + " – " + J.Str(c, "title") +
                    (J.Str(c, "album").Length > 0 ? " · " + J.Str(c, "album") : "") + (J.Ok(J.Get(c, "year")) ? " (" + J.Str(c, "year") + ")" : "") + (J.Str(c, "coverUrl").Length > 0 ? " · mit Cover" : "") + "  [" + J.Str(c, "source") + "]")).ToList());
                if (pick == null) { C.Status("", false); return; }
                var c0 = cands[int.Parse(pick)];
                var v = Dlg.Form(C.Owner, "Übernehmen", "Übernehmen",
                    Field.Check("overwrite", "Vorhandene Angaben überschreiben (sonst nur leere Felder füllen)", false),
                    Field.Check("cover", "Cover übernehmen", J.Str(c0, "coverUrl").Length > 0));
                if (v == null) return;
                object year = J.Ok(J.Get(c0, "year")) ? (object)J.Long(c0, "year") : null;
                await C.Api.PostJ(C.St("/media/" + Uri.EscapeDataString(id) + "/lookup"), new
                {
                    title = J.Str(c0, "title"), artist = J.Str(c0, "artist"), album = J.Str(c0, "album"), genre = J.Str(c0, "genre"), year,
                    coverUrl = J.Str(c0, "coverUrl"), overwrite = v["overwrite"] == "true", cover = v["cover"] == "true",
                }, 40);
                ForgetCover(id);
                await Load();
                C.Ok("Angaben übernommen");
            }, "Online-Suche");
        }

        async Task Delete()
        {
            var rows = table.Many.ToList();
            if (rows.Count == 0 || !Dlg.Confirm(C.Owner, rows.Count == 1 ? "„" + J.Str(rows[0].El, "title") + "“ endgültig löschen?" : rows.Count + " Titel endgültig löschen?")) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St("/media/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); C.Ok(rows.Count + " Titel gelöscht"); }, "Löschen");
        }

        /// <summary>Vorhören: Datei laden und hier abspielen; zweiter Aufruf für denselben Titel stoppt.</summary>
        async Task Preview()
        {
            var r = table.One;
            if (r == null) return;
            var id = J.Str(r.El, "id");
            if (playingId == id) { StopPreview(); return; }
            StopPreview();
            await C.Run(async () =>
            {
                C.Status("Lade Vorschau …", false);
                var data = await C.Api.Download(C.St("/media/" + Uri.EscapeDataString(id) + "/file"));
                var ext = Path.GetExtension(J.Str(r.El, "file"));
                var path = Path.Combine(Path.GetTempPath(), "anmachacast-vorschau" + (string.IsNullOrEmpty(ext) ? ".mp3" : ext));
                File.WriteAllBytes(path, data);
                player = new MediaPlayer();
                player.MediaEnded += (s, e) => StopPreview();
                player.MediaFailed += (s, e) => { StopPreview(); C.Status("Vorschau nicht abspielbar", true); };
                player.Open(new Uri(path));
                player.Play();
                playingId = id;
                C.Ok("Vorschau: " + J.Str(r.El, "title") + " (Doppelklick stoppt)");
            }, "Vorschau");
        }

        public void StopPreview()
        {
            try { player?.Stop(); player?.Close(); } catch { }
            player = null;
            playingId = null;
        }
    }
}
