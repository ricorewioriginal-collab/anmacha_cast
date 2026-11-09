// Studio: Betriebsart, On-Air, Mikrofon, die vier Decks (A–D), Cardwall und Warteschlange - die Bedienung im Sendebetrieb.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;
using AnMaChaCast.ViewModels;

namespace AnMaChaCast.Pages
{
    sealed class StudioPage : View
    {
        static readonly string[] DeckIds = { "A", "B", "C", "D" };

        readonly List<DeckViewModel> decks = DeckIds.Select(id => new DeckViewModel(id)).ToList();
        readonly List<DeckCard> cards = new List<DeckCard>();
        readonly WrapPanel cartPanel = new WrapPanel();
        readonly Table queue = new Table(("Zeit", 60), ("Titel", 200), ("Interpret", 130), ("Dauer", 55));
        readonly DispatcherTimer watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        readonly DispatcherTimer tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };

        Dictionary<string, MediaItem> library = new Dictionary<string, MediaItem>();
        List<CartSlot> carts = new List<CartSlot>();
        bool loaded;

        public override string Title => "Studio";

        // Archiv (Playlist/Mediathek zum Einreihen), Encoder, Automation und Schnellzugriff wie im Web-Live-Studio
        readonly Table archive = new Table(("Titel", 200), ("Interpret", 150), ("Dauer", 55));
        readonly TextBox search = Kit.Box("", 160);
        readonly ComboBox playlists = new ComboBox { MinWidth = 150, DisplayMemberPath = "Item2" };
        readonly Table encoders = new Table(("Encoder", 130), ("Zustand", 110));
        readonly TextBlock autoState = Kit.Text("–", 12, true);
        readonly CheckBox autoFill = new CheckBox { Content = "Nach Sendeuhr auffüllen", Margin = new Thickness(0, 6, 0, 0) };
        readonly UniformGrid deckGrid = new UniformGrid { Columns = 4, Margin = new Thickness(-4, -4, -4, 6) };
        readonly Grid lower = new Grid();
        readonly Grid content = new Grid();
        Border cartCard, archiveCard, queueCard;
        ScrollViewer side;
        bool narrow;
        bool settingFill;
        int slowTicks;

        public StudioPage(Ctx c) : base(c)
        {
            // ON AIR, Betriebsart, MIC LIVE, Mithören und Sendung liegen wie im Web-Studio in der Kopfzeile (Ui/OnAirBar.cs).
            // Kleine Bildschirme: alles scrollt senkrecht statt abgeschnitten zu werden, Decks zweispaltig.
            content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = content };
            Children.Add(scroll);

            foreach (var d in decks) { var card = new DeckCard(d, this); cards.Add(card); deckGrid.Children.Add(card); }
            content.Children.Add(deckGrid);

            // .carts: so viele Spalten wie passen (mind. 120 px je Taste), Tasten füllen ihre Spalte
            cartPanel.SizeChanged += (s, e) =>
            {
                var w = e.NewSize.Width;
                if (w <= 0) return;
                var cols = Math.Max(1, (int)(w / 120));
                cartPanel.ItemWidth = Math.Floor(w / cols);
            };
            cartCard = Kit.Card("Cardwall", Kit.Scroll(cartPanel), "Klick = abspielen · Rechtsklick = belegen, Taste zuweisen oder leeren · F1–F4 = Decks · Esc = alle Carts stoppen");

            // Playlist / Archiv: suchen, einreihen, auf ein Deck legen, ganze Playlist spielen
            search.TextChanged += (s, e) => FillArchive();
            archive.MouseDoubleClick += async (s, e) => await EnqueueSelected();
            var archiveBody = new DockPanel();
            var archiveTop = Kit.V(
                Kit.Wrap(Kit.Text("Suchen"), search, Kit.Btn("Einreihen", EnqueueSelected, "Markierte Titel in die Warteschlange (Doppelklick)", true),
                    Kit.Btn("Auf Deck A", () => ToDeck("A")), Kit.Btn("B", () => ToDeck("B")), Kit.Btn("C", () => ToDeck("C")), Kit.Btn("D", () => ToDeck("D"))),
                Kit.Wrap(Kit.Text("Playlist"), playlists, Kit.Btn("Playlist spielen", PlayPlaylist, "Die gewählte Playlist in die Warteschlange übernehmen")));
            DockPanel.SetDock(archiveTop, Dock.Top);
            archiveBody.Children.Add(archiveTop);
            archiveBody.Children.Add(archive);
            archiveCard = Kit.Card("Playlist / Archiv", archiveBody);

            var qBody = new Grid();
            qBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            qBody.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            qBody.Children.Add(queue);
            var qButtons = Kit.Wrap(
                Kit.Btn("Titel einreihen …", AddToQueue),
                Kit.Btn("Entfernen", RemoveFromQueue),
                Kit.Btn("▲", () => MoveInQueue(-1), "Nach oben"),
                Kit.Btn("▼", () => MoveInQueue(1), "Nach unten"),
                Kit.Btn("Mischen", () => QueueAction("shuffle")),
                Kit.Btn("Auffüllen", () => QueueAction("fill"), "Aus der Rotation auffüllen"),
                Kit.Btn("Leeren", ClearQueue));
            Grid.SetRow(qButtons, 1);
            qBody.Children.Add(qButtons);
            queueCard = Kit.Card("Warteschlange", qBody);

            // rechte Spalte: Automation, Schnellzugriff, Stream & Encoder
            autoFill.Click += async (s, e) => { if (!settingFill) await C.Run(() => C.Api.PatchJ(C.St("/automation"), new { autoFill = autoFill.IsChecked == true }), "Sendeuhr"); };
            var automation = Kit.Card("Automation 24/7", Kit.V(autoState,
                Kit.Wrap(Kit.Btn("Start", StartAutomation, "Server-Playout starten", true), Kit.Btn("Weiter ⏭", () => C.Run(() => C.Api.PostJ(C.St("/playout/skip")), "Weiter"), "Nächsten Titel sofort"), Kit.Btn("Stop", StopAutomation)),
                autoFill));
            var quick = new UniformGrid { Columns = 2 };
            foreach (var (cat, label) in Quick) quick.Children.Add(Kit.Btn(label, () => QuickTrigger(cat, label), new[] { "news", "ad", "voice_track" }.Contains(cat) ? label + ": sofort per Crossfade" : label + ": über der Musik"));
            var quickCard = Kit.Card("Schnellzugriff", Kit.V(quick, Kit.Wrap(Kit.Btn("■ Alle Carts stoppen", () => C.Run(() => C.Api.PostJ(C.St("/playout/carts-stop")), "Carts"), "Laufende Jingles/Carts sofort stoppen"))));
            encoders.MinHeight = 90;
            encoders.MaxHeight = 220;
            encoders.MouseDoubleClick += async (s, e) => await ToggleEncoder();
            var encCard = Kit.Card("Stream & Encoder", Kit.V(encoders, Kit.Wrap(Kit.Btn("Verbinden / Trennen", ToggleEncoder, "Markierten Encoder verbinden oder trennen (Doppelklick)", true),
                Kit.Btn("Alle verbinden", () => SetAllEncoders(true)), Kit.Btn("Alle trennen", () => SetAllEncoders(false)))));
            side = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = Kit.V(automation, quickCard, encCard) };

            lower.Children.Add(cartCard);
            lower.Children.Add(archiveCard);
            lower.Children.Add(queueCard);
            lower.Children.Add(side);
            Grid.SetRow(lower, 1);
            content.Children.Add(lower);
            SizeChanged += (s, e) => Arrange(e.NewSize.Width, e.NewSize.Height);
            Arrange(1400, 900);

            watch.Tick += (s, e) => { if (IsVisible && C.Connected) _ = RefreshQuiet(); };
            tick.Tick += (s, e) => { foreach (var d in decks) d.Tick(500); };
            tick.Start();
            watch.Start();
        }

        static readonly (string Cat, string Label)[] Quick =
        {
            ("news", "News"), ("jingle", "Jingle"), ("ad", "Werbung"), ("station_id", "Station ID"),
            ("voice_track", "Voice Track"), ("sweeper", "Sweeper"), ("drop", "Drop"), ("tts", "TTS"),
        };

        /// <summary>Breite Fenster: Cardwall + Archiv | Warteschlange | rechte Spalte. Schmale Fenster: zwei Spalten, die rechte
        /// Spalte darunter, alles scrollt senkrecht (Laptop mit 1366×768).</summary>
        void Arrange(double width, double height)
        {
            var nowNarrow = width < 1180;
            deckGrid.Columns = width < 860 ? 2 : 4; // Laptop (1366×768, 125 %) bleibt vierspaltig
            // im ScrollViewer gibt es keine feste Höhe: so hoch wie die Seite, mindestens so hoch, dass nichts gequetscht wird
            if (height > 0) content.Height = Math.Max(height, (width < 860 ? 520 : 270) + (nowNarrow ? 900 : 480));
            if (nowNarrow == narrow && lower.ColumnDefinitions.Count > 0) return;
            narrow = nowNarrow;
            lower.ColumnDefinitions.Clear();
            lower.RowDefinitions.Clear();
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.15, GridUnitType.Star) });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            if (!narrow) lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(300) });
            // schmal: Automation, Schnellzugriff und Encoder direkt unter den Decks (ohne Bildlauf erreichbar), darunter der Rest
            var top = narrow ? 1 : 0;
            if (narrow) lower.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            lower.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 230 });
            lower.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = 230 });
            Place(cartCard, top, 0, 1, 1);
            Place(archiveCard, top + 1, 0, 1, 1);
            Place(queueCard, top, 1, 2, 1);
            if (narrow) Place(side, 0, 0, 1, 2); else Place(side, 0, 2, 2, 1);
            side.VerticalScrollBarVisibility = narrow ? ScrollBarVisibility.Disabled : ScrollBarVisibility.Auto;
            side.HorizontalScrollBarVisibility = narrow ? ScrollBarVisibility.Auto : ScrollBarVisibility.Disabled;
            if (side.Content is StackPanel sp) sp.Orientation = narrow ? Orientation.Horizontal : Orientation.Vertical;
            if (side.Content is StackPanel sp2) foreach (FrameworkElement el in sp2.Children) { el.Width = narrow ? 300 : double.NaN; el.Margin = new Thickness(0, 0, narrow ? 10 : 0, 10); }
            foreach (var el in new FrameworkElement[] { cartCard, archiveCard }) el.Margin = new Thickness(0, 0, 10, 10);
            queueCard.Margin = new Thickness(0, 0, narrow ? 0 : 10, 10);
        }

        static void Place(UIElement el, int row, int col, int rowSpan, int colSpan)
        {
            SetRow(el, row); SetColumn(el, col); SetRowSpan(el, rowSpan); SetColumnSpan(el, colSpan);
        }

        // ---------- Laden ----------

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var lib = C.Api.Library(C.StationId);
                var carts = C.Api.Cardwall(C.StationId);
                var playout = C.Api.Playout(C.StationId);
                await Task.WhenAll(lib, carts, playout);
                library = lib.Result.Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                FillArchive();
                ApplyCarts(carts.Result);
                await ApplyPlayout(playout.Result);
                await LoadQueue();
                await LoadSide();
                await LoadPlaylists();
                loaded = true;
            }, "Studio laden");
        }

        async Task RefreshQuiet()
        {
            try
            {
                await ApplyPlayout(await C.Api.Playout(C.StationId));
                // Encoder/Automation seltener abfragen (alle 9 s) – spart Last auf Server und PC
                if (++slowTicks % 3 == 0) await LoadSide();
            }
            catch { /* nächster Versuch in 3 s */ }
        }

        public override async void OnEvent(string type)
        {
            if (!C.Connected || !loaded) return;
            try
            {
                switch (type)
                {
                    case "library.changed":
                        library = (await C.Api.Library(C.StationId)).Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                        FillArchive();
                        break;
                    case "playlists.changed":
                        await LoadPlaylists();
                        break;
                    case "cardwall.changed":
                    case "cardwall.triggered":
                        ApplyCarts(await C.Api.Cardwall(C.StationId));
                        break;
                    case "deck.state_changed":
                    case "playout.state":
                    case "automation.state_changed":
                    case "station.changed":
                        await ApplyPlayout(await C.Api.Playout(C.StationId));
                        if (type != "deck.state_changed") await LoadSide();
                        break;
                    case "queue.changed":
                        await LoadQueue();
                        break;
                }
            }
            catch { /* das nächste Ereignis oder der 3-s-Abgleich korrigiert es */ }
        }

        async Task ApplyPlayout(PlayoutView p)
        {
            if (p?.status?.decks != null && p.status.decks.Count > 0)
            {
                foreach (var ed in p.status.decks)
                {
                    var vm = decks.FirstOrDefault(d => d.Id == ed.id);
                    if (vm == null) continue;
                    vm.Title = string.IsNullOrEmpty(ed.title) ? "– leer –" : ed.title;
                    vm.Artist = ed.artist ?? "";
                    vm.Status = ed.state;
                    vm.Auto = ed.auto;
                    vm.PositionMs = ed.positionMs;
                    vm.DurationMs = ed.durationMs;
                    vm.Tempo = ed.tempo ?? 1;
                }
                return;
            }
            // Server-Playout noch nicht gestartet: einfache Deck-Grunddaten mit Titeln aus der Mediathek
            try
            {
                foreach (var d in await C.Api.Decks(C.StationId))
                {
                    var vm = decks.FirstOrDefault(x => x.Id == d.id);
                    if (vm == null) continue;
                    MediaItem media = d.mediaId != null && library.TryGetValue(d.mediaId, out var mm) ? mm : null;
                    vm.Title = media?.title ?? (d.mediaId == null ? "– leer –" : d.mediaId);
                    vm.Artist = media?.artist ?? "";
                    vm.Status = d.status;
                    vm.Auto = false;
                    vm.PositionMs = 0;
                    vm.DurationMs = media?.durationMs;
                }
            }
            catch { }
        }

        // ---------- Decks ----------

        public Task DeckAction(DeckViewModel d, string action, object body = null) =>
            C.Run(async () => { await C.Api.DeckAction(C.StationId, d.Id, action, body); await ApplyPlayout(await C.Api.Playout(C.StationId)); }, "Deck " + d.Id);

        public Task Skip(DeckViewModel d, int deltaMs)
        {
            var target = Math.Max(0, d.PositionMs + deltaMs);
            return C.Run(async () => { await C.Api.DeckAction(C.StationId, d.Id, "seek", new { ms = target }); d.PositionMs = target; }, "Deck " + d.Id);
        }

        public async Task LoadIntoDeck(DeckViewModel d)
        {
            var id = Dlg.Pick(C.Owner, "Titel auf Deck " + d.Id + " laden", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            await DeckAction(d, "load", new { mediaId = id });
        }

        public Task SetTempo(DeckViewModel d, double tempo) => DeckAction(d, "tempo", new { tempo = Math.Round(tempo, 2) });

        static string Label(MediaItem m) => string.IsNullOrEmpty(m.artist) ? m.title : m.artist + " – " + m.title;

        // ---------- Cardwall ----------

        void ApplyCarts(List<CartSlot> slots)
        {
            carts = slots ?? new List<CartSlot>();
            cartPanel.Children.Clear();
            foreach (var slot in slots)
            {
                var s = slot;
                Color color;
                try { color = Theme.C(string.IsNullOrEmpty(s.color) ? "#38BDF8" : s.color); } catch (Exception ex) when (ex is FormatException || ex is NotSupportedException) { color = Theme.C("#38BDF8"); }
                var has = !string.IsNullOrEmpty(s.mediaId);
                // .cart: Verlauf in der Cart-Farbe, freie Tasten nur mit feinem Rahmen
                var b = new Button
                {
                    Height = 64, Margin = new Thickness(4), Padding = new Thickness(10, 6, 10, 6),
                    Background = has ? Theme.Linear(160, (Theme.Mix(color, 0.72, Theme.C("#0D1424")), 0), (Theme.Mix(color, 0.5, Theme.C("#0D1424")), 1)) : (Brush)Brushes.Transparent,
                    BorderBrush = has ? Theme.Solid(Theme.Alpha(color, 0.8)) : Kit.Line2, Foreground = has ? Brushes.White : Kit.Muted,
                    Content = new TextBlock { Text = (string.IsNullOrEmpty(s.label) ? (has ? "Cart" : "leer") : s.label) + (has && !string.IsNullOrEmpty(s.hotkey) ? "  [" + s.hotkey.ToUpperInvariant() + "]" : ""), TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontWeight = has ? FontWeights.Bold : FontWeights.Normal },
                };
                b.Click += async (o, e) => { if (has) await C.Run(() => C.Api.TriggerCart(C.StationId, s.id), "Cart"); };
                var menu = new ContextMenu();
                var assign = new MenuItem { Header = "Titel zuweisen …" };
                assign.Click += async (o, e) => await AssignCart(s);
                var clear = new MenuItem { Header = "Leeren" };
                clear.Click += async (o, e) => await C.Run(async () => { await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = (string)null, label = "" }); ApplyCarts(await C.Api.Cardwall(C.StationId)); }, "Cart");
                var key = new MenuItem { Header = "Taste zuweisen …" };
                key.Click += async (o, e) =>
                {
                    var v = Dlg.Form(C.Owner, "Taste für diese Cart", "Speichern", Field.Text("hotkey", "Taste (Buchstabe oder Ziffer, leer = keine)", s.hotkey ?? ""));
                    if (v == null) return;
                    var k = v["hotkey"].Trim().ToLowerInvariant();
                    if (k.Length > 1 || (k.Length == 1 && !char.IsLetterOrDigit(k[0]))) { C.Status("Bitte genau einen Buchstaben oder eine Ziffer angeben", true); return; }
                    await C.Run(async () => { await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { hotkey = k }); ApplyCarts(await C.Api.Cardwall(C.StationId)); }, "Cart");
                };
                menu.Items.Add(assign);
                menu.Items.Add(key);
                menu.Items.Add(clear);
                b.ContextMenu = menu;
                cartPanel.Children.Add(b);
            }
        }

        async Task AssignCart(CartSlot s)
        {
            var id = Dlg.Pick(C.Owner, "Titel für diese Taste", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            var m = library[id];
            var v = Dlg.Form(C.Owner, "Cart beschriften", "Speichern", Field.Text("label", "Beschriftung", string.IsNullOrEmpty(s.label) ? m.title : s.label));
            if (v == null) return;
            await C.Run(async () =>
            {
                await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = id, label = v["label"] });
                ApplyCarts(await C.Api.Cardwall(C.StationId));
            }, "Cart");
        }

        // ---------- Tastenkürzel (wie im Web-Studio) ----------

        /// <summary>
        /// F1–F4: Deck A–D abspielen/pausieren · Esc: alle Carts stoppen · Cart-Taste (in der Cardwall belegt): Cart auslösen.
        /// Nicht, während in ein Eingabefeld getippt wird. true = Taste verarbeitet.
        /// </summary>
        public bool HandleKey(System.Windows.Input.Key key, bool typing)
        {
            if (!C.Connected) return false;
            if (key >= System.Windows.Input.Key.F1 && key <= System.Windows.Input.Key.F4)
            {
                var d = decks[key - System.Windows.Input.Key.F1];
                _ = DeckAction(d, d.IsPlaying ? "pause" : "play");
                return true;
            }
            if (typing) return false;
            if (key == System.Windows.Input.Key.Escape)
            {
                _ = C.Run(async () => { await C.Api.PostJ(C.St("/playout/carts-stop")); C.Ok("Alle Carts gestoppt"); }, "Carts");
                return true;
            }
            var ch = KeyChar(key);
            if (ch == null) return false;
            var slot = carts.FirstOrDefault(s => !string.IsNullOrEmpty(s.mediaId) && string.Equals(s.hotkey, ch, StringComparison.OrdinalIgnoreCase));
            if (slot == null) return false;
            _ = C.Run(() => C.Api.TriggerCart(C.StationId, slot.id), "Cart");
            return true;
        }

        static string KeyChar(System.Windows.Input.Key key)
        {
            if (key >= System.Windows.Input.Key.A && key <= System.Windows.Input.Key.Z) return ((char)('a' + (key - System.Windows.Input.Key.A))).ToString();
            if (key >= System.Windows.Input.Key.D0 && key <= System.Windows.Input.Key.D9) return ((char)('0' + (key - System.Windows.Input.Key.D0))).ToString();
            if (key >= System.Windows.Input.Key.NumPad0 && key <= System.Windows.Input.Key.NumPad9) return ((char)('0' + (key - System.Windows.Input.Key.NumPad0))).ToString();
            return null;
        }

        // ---------- Playlist / Archiv ----------

        void FillArchive()
        {
            var q = search.Text.Trim();
            var items = library.Values.Where(m => q.Length == 0 || (m.title ?? "").IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0 || (m.artist ?? "").IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0)
                .OrderBy(m => m.artist).ThenBy(m => m.title).Take(500);
            archive.Set(items.Select(m => new Row(JsonDocument.Parse(JsonSerializer.Serialize(new { m.id })).RootElement.Clone(), m.title ?? m.id, m.artist ?? "", Fmt.Dur(m.durationMs))));
        }

        async Task LoadPlaylists()
        {
            try
            {
                var pl = await C.Api.GetJ(C.St("/playlists"));
                var sel = (playlists.SelectedItem as Tuple<string, string>)?.Item1;
                var list = J.Arr(pl).Select(p => Tuple.Create(J.Str(p, "id"), J.Str(p, "name"))).ToList();
                playlists.ItemsSource = list;
                playlists.SelectedItem = list.FirstOrDefault(x => x.Item1 == sel) ?? list.FirstOrDefault();
            }
            catch (ApiException) { playlists.ItemsSource = null; }
        }

        async Task EnqueueSelected()
        {
            var rows = archive.Many.ToList();
            if (rows.Count == 0) { C.Status("Bitte einen Titel im Archiv markieren", true); return; }
            await C.Run(async () =>
            {
                foreach (var r in rows) await C.Api.PostJ(C.St("/queue"), new { mediaId = J.Str(r.El, "id") });
                await LoadQueue();
                C.Ok(rows.Count == 1 ? "Eingereiht: " + rows[0].Cells[0] : rows.Count + " Titel eingereiht");
            }, "Warteschlange");
        }

        async Task ToDeck(string deck)
        {
            var r = archive.One;
            if (r == null) { C.Status("Bitte einen Titel im Archiv markieren", true); return; }
            var vm = decks.First(d => d.Id == deck);
            await DeckAction(vm, "load", new { mediaId = J.Str(r.El, "id") });
        }

        Task PlayPlaylist()
        {
            if (!(playlists.SelectedItem is Tuple<string, string> p)) { C.Status("Keine Playlist vorhanden – unter „Playlisten“ anlegen", true); return Task.CompletedTask; }
            return C.Run(async () => { await C.Api.PostJ(C.St("/playlists/" + Uri.EscapeDataString(p.Item1) + "/play")); await LoadQueue(); C.Ok("Playlist „" + p.Item2 + "“ wird gespielt"); }, "Playlist");
        }

        // ---------- Automation, Schnellzugriff, Encoder ----------

        async Task LoadSide()
        {
            var po = C.Api.GetJ(C.St("/playout"));
            var outs = C.Api.GetJ(C.St("/outputs"));
            try { await Task.WhenAll(po, outs); } catch (Exception ex) when (ex is ApiException || ex is TaskCanceledException) { }
            if (po.Status == TaskStatus.RanToCompletion)
            {
                var running = J.Bool(po.Result, "status.running");
                autoState.Text = running ? "● Sendet" + (J.Str(po.Result, "status.current.title").Length > 0 ? " – " + J.Str(po.Result, "status.current.title") : "") : "Gestoppt";
                autoState.Foreground = running ? Kit.Good : Kit.Muted;
            }
            if (outs.Status == TaskStatus.RanToCompletion)
                encoders.Set(J.Arr(outs.Result).Select(x => new Row(x, J.Str(x, "name"), OutputsPage.EncoderState(x))));
        }

        Task StartAutomation() => C.Run(async () => { await C.Api.StartPlayout(C.StationId); await LoadSide(); C.Ok("Automation läuft"); }, "Automation");

        async Task StopAutomation()
        {
            if (!Dlg.Confirm(C.Owner, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.")) return;
            await C.Run(async () => { await C.Api.StopPlayout(C.StationId); await LoadSide(); }, "Automation");
        }

        Task QuickTrigger(string cat, string label) => C.Run(async () =>
        {
            var m = await C.Api.PostJ(C.St("/quick/" + cat), new { });
            C.Ok("Schnellzugriff " + label + ": " + J.Str(m, "title", "läuft"));
        }, label);

        async Task ToggleEncoder()
        {
            var r = encoders.One;
            if (r == null) { C.Status("Bitte einen Encoder markieren", true); return; }
            var on = !J.Bool(r.El, "enabled", true);
            await C.Run(async () =>
            {
                await C.Api.PatchJ(C.St("/outputs/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { enabled = on });
                await LoadSide();
                C.Ok(J.Str(r.El, "name") + (on ? " verbunden – sendet, sobald etwas auf Sendung ist" : " getrennt"));
            }, "Encoder");
        }

        async Task SetAllEncoders(bool on)
        {
            var rows = (encoders.ItemsSource as IEnumerable<Row> ?? new Row[0]).Where(r => J.Bool(r.El, "enabled", true) != on).ToList();
            if (!on && rows.Count > 0 && !Dlg.Confirm(C.Owner, "Alle Encoder trennen? Die Hörer hören dann nichts mehr.")) return;
            await C.Run(async () =>
            {
                foreach (var r in rows) await C.Api.PatchJ(C.St("/outputs/" + Uri.EscapeDataString(J.Str(r.El, "id"))), new { enabled = on });
                await LoadSide();
                C.Ok(rows.Count + (on ? " Encoder verbunden" : " Encoder getrennt"));
            }, "Encoder");
        }

        // ---------- Warteschlange ----------

        async Task LoadQueue()
        {
            var q = await C.Api.GetJ(C.St("/queue"));
            settingFill = true;
            autoFill.IsChecked = J.Bool(q, "autoFill");
            settingFill = false;
            queue.Set(J.Arr(q, "items").Select(it => new Row(it,
                it.TryGetProperty("startsAt", out var sa) && sa.ValueKind == JsonValueKind.Number ? DateTimeOffset.FromUnixTimeMilliseconds(sa.GetInt64()).ToLocalTime().ToString("HH:mm") : "",
                J.Str(it, "media.title", J.Str(it, "mediaId")), J.Str(it, "media.artist"), Fmt.Dur(J.Ok(J.At(it, "media.durationMs")) ? J.Long(it, "media.durationMs") : (long?)null))));
        }

        async Task AddToQueue()
        {
            var id = Dlg.Pick(C.Owner, "Titel einreihen", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue"), new { mediaId = id }); await LoadQueue(); }, "Warteschlange");
        }

        async Task RemoveFromQueue()
        {
            var rows = queue.Many.ToList();
            if (rows.Count == 0) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St("/queue/" + Uri.EscapeDataString(J.Str(r.El, "uid")))); await LoadQueue(); }, "Warteschlange");
        }

        async Task MoveInQueue(int delta)
        {
            var r = queue.One;
            if (r == null) return;
            var index = queue.Items.IndexOf(r) + delta;
            if (index < 0 || index >= queue.Items.Count) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + Uri.EscapeDataString(J.Str(r.El, "uid")) + "/move"), new { to = index }); await LoadQueue(); queue.SelectedIndex = index; }, "Warteschlange");
        }

        Task QueueAction(string action) => C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + action)); await LoadQueue(); }, "Warteschlange");

        async Task ClearQueue()
        {
            if (queue.Items.Count == 0 || !Dlg.Confirm(C.Owner, "Die ganze Warteschlange leeren?")) return;
            await QueueAction("clear");
        }
    }

    /// <summary>Ein Deck als Karte wie .deck im Web-Studio (Farbe je Deck, farbige Kopfzeile, Titelkachel, Restzeit, runde Knöpfe).
    /// Aktualisiert sich selbst aus dem DeckViewModel.</summary>
    sealed class DeckCard : Border
    {
        // --deck-a … --deck-d aus studio/styles.css
        static readonly Dictionary<string, string> DeckColors = new Dictionary<string, string> { ["A"] = "#38BDF8", ["B"] = "#22C55E", ["C"] = "#F59E0B", ["D"] = "#EC4899" };

        readonly DeckViewModel vm;
        readonly Color color;
        readonly TextBlock title = Kit.Text("", 14, true);
        readonly TextBlock artist = Kit.Text("", 12, false, Kit.Muted);
        readonly TextBlock status = new TextBlock { FontSize = 11, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Opacity = 0.9, VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock remain = new TextBlock { FontSize = 22, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom };
        readonly TextBlock letter = new TextBlock { FontSize = 18, FontWeight = FontWeights.Black, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        readonly ProgressBar bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, BorderThickness = new Thickness(0), Margin = new Thickness(0, 10, 0, 8) };
        readonly Slider tempo = new Slider { Minimum = 0.8, Maximum = 1.25, Value = 1, TickFrequency = 0.05, SmallChange = 0.01, LargeChange = 0.05, IsSnapToTickEnabled = false };
        readonly TextBlock tempoText = Kit.Text("1,00×", 11, false, Kit.Muted);
        bool settingTempo;
        bool dragging;

        public DeckCard(DeckViewModel vm, StudioPage page)
        {
            this.vm = vm;
            color = Theme.C(DeckColors.TryGetValue(vm.Id, out var hex) ? hex : "#38BDF8");
            var c = Theme.Solid(color);
            CornerRadius = new CornerRadius(18);
            Margin = new Thickness(4);
            BorderThickness = new Thickness(1);
            BorderBrush = Theme.Solid(Theme.Alpha(color, 0.55));
            Background = Theme.Linear(165, (Theme.Mix(color, 0.22, Theme.C("#0D1424")), 0), (Theme.C("#0A1120"), 0.65));
            SnapsToDevicePixels = true;
            remain.Foreground = c;
            bar.Foreground = c;
            bar.Background = Theme.Solid(Theme.C("#0DFFFFFF"));
            tempo.Foreground = c;

            // .deck-head: farbiger Streifen mit Name und Zustand
            var head = new DockPanel { LastChildFill = true };
            DockPanel.SetDock(status, Dock.Right);
            head.Children.Add(status);
            var name = Kit.H(Kit.Icon("\uEC4F", 13, Brushes.White), new TextBlock { Text = "Deck " + vm.Id, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            head.Children.Add(name);
            var headBand = new Border
            {
                CornerRadius = new CornerRadius(17, 17, 0, 0), Padding = new Thickness(12, 8, 12, 8), MinHeight = 36, Child = head,
                Background = Theme.Linear(90, (Theme.Alpha(color, 0.55), 0), (Theme.Alpha(color, 0.16), 1)),
            };

            // Titelkachel + Titel/Interpret + Restzeit
            var tile = new Border
            {
                Width = 52, Height = 52, CornerRadius = new CornerRadius(12), Margin = new Thickness(0, 0, 10, 0), Child = letter,
                Background = Theme.Linear(135, (color, 0), (Theme.Mix(color, 0.45, Theme.C("#818CF8")), 1)),
            };
            var info = new Grid();
            info.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            info.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            info.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            info.Children.Add(tile);
            var texts = Kit.V(title, artist);
            texts.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(texts, 1);
            info.Children.Add(texts);
            Grid.SetColumn(remain, 2);
            info.Children.Add(remain);

            // .deck-ctrl: runde Knöpfe, Abspielen in der Deckfarbe
            var buttons = new UniformGrid { Rows = 1, Columns = 6 };
            buttons.Children.Add(DeckBtn("−10", () => page.Skip(vm, -10000), "10 Sekunden zurück", false));
            buttons.Children.Add(DeckBtn("\uE768", () => page.DeckAction(vm, "play"), "Abspielen", true));
            buttons.Children.Add(DeckBtn("\uE769", () => page.DeckAction(vm, "pause"), "Pause", true));
            buttons.Children.Add(DeckBtn("\uE71A", () => page.DeckAction(vm, "stop"), "Stopp (bereit)", true));
            buttons.Children.Add(DeckBtn("+10", () => page.Skip(vm, 10000), "10 Sekunden vor", false));
            buttons.Children.Add(DeckBtn("\uE711", () => page.DeckAction(vm, "eject"), "Deck leeren", true));

            tempo.ValueChanged += (s, e) => tempoText.Text = (tempo.Value >= 1 ? "+" : "−") + Math.Abs((tempo.Value - 1) * 100).ToString("0", System.Globalization.CultureInfo.GetCultureInfo("de-DE")) + " %";
            tempo.PreviewMouseLeftButtonDown += (s, e) => dragging = true;
            tempo.PreviewMouseLeftButtonUp += async (s, e) => { dragging = false; if (!settingTempo) await page.SetTempo(vm, tempo.Value); };
            tempo.ToolTip = "Tempo 0,8–1,25 (Tonhöhe bleibt) – loslassen zum Übernehmen; Doppelklick = normal";
            tempo.MouseDoubleClick += async (s, e) => { tempo.Value = 1; await page.SetTempo(vm, 1); };
            tempoText.Text = "±0 %";
            tempoText.MinWidth = 44;
            tempoText.TextAlignment = TextAlignment.Right;
            var tempoRow = new DockPanel { Margin = new Thickness(2, 8, 2, 0) };
            DockPanel.SetDock(tempoText, Dock.Right);
            tempoRow.Children.Add(tempoText);
            tempoRow.Children.Add(tempo);

            var load = Kit.Btn("Titel laden …", () => page.LoadIntoDeck(vm));
            load.HorizontalAlignment = HorizontalAlignment.Stretch;
            load.Margin = new Thickness(2, 8, 2, 0);

            var body = Kit.V(info, bar, buttons, tempoRow, load);
            body.Margin = new Thickness(10, 10, 10, 10);
            Child = Kit.V(headBand, body);
            vm.PropertyChanged += (s, e) => Update();
            Update();
        }

        /// <summary>.deck-btn: runder Knopf; Symbole aus der Windows-Symbolschrift, Sprungtasten als Text.</summary>
        Button DeckBtn(string label, Func<Task> click, string tip, bool icon)
        {
            var b = Kit.Btn(label, click, tip);
            b.Margin = new Thickness(2);
            b.Padding = new Thickness(0, 6, 0, 6);
            b.FontSize = 12;
            b.FontWeight = FontWeights.SemiBold;
            if (icon) b.Content = Kit.Icon(label, 13);
            if (tip == "Abspielen") { b.BorderBrush = Theme.Solid(color); b.Foreground = Theme.Solid(color); }
            return b;
        }

        void Update()
        {
            title.Text = vm.Title;
            artist.Text = vm.Artist;
            status.Text = (vm.StatusLabel ?? "").ToUpperInvariant();
            var t = (vm.Title ?? "").Trim();
            letter.Text = vm.HasMedia && t.Length > 0 ? char.ToUpperInvariant(t[0]).ToString() : vm.Id;
            bar.Value = vm.ProgressFraction;
            remain.Text = vm.RemainingLabel;
            if (!dragging && Math.Abs(tempo.Value - vm.Tempo) > 0.004)
            {
                settingTempo = true;
                tempo.Value = vm.Tempo;
                settingTempo = false;
            }
        }
    }
}
