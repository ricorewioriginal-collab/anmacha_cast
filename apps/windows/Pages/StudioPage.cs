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

        readonly System.Windows.Shapes.Ellipse dot = new System.Windows.Shapes.Ellipse { Width = 9, Height = 9, Fill = Kit.Muted, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock onAir = Kit.Text("OFF AIR", 12, true, Kit.Muted);
        readonly Border onAirPill = new Border { CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), Padding = new Thickness(13, 0, 13, 0), MinHeight = 36, VerticalAlignment = VerticalAlignment.Center };
        readonly ToggleButton btnAuto;
        readonly ToggleButton btnManual;
        readonly ToggleButton btnMic;
        readonly Button btnStream;

        Dictionary<string, MediaItem> library = new Dictionary<string, MediaItem>();
        bool micOn;
        bool busRunning;
        bool loaded;

        public override string Title => "Studio";

        public StudioPage(Ctx c) : base(c)
        {
            btnAuto = Kit.Toggle("24/7 AutoDJ", () => _ = SetMode("AUTO"), "Automation sendet rund um die Uhr");
            btnManual = Kit.Toggle("Manuell", () => _ = SetMode("MANUAL"), "Selbst live fahren");
            btnMic = Kit.Toggle("MIC LIVE", () => _ = ToggleMic(), "Mikrofon live senden (Übernahme nach Priorität)");
            btnStream = Kit.Btn("Sendung starten", ToggleStream, primary: true);
            foreach (var b in new[] { btnAuto, btnManual }) { b.Margin = new Thickness(0); Theme.Use(b, b == btnAuto ? "Seg.Auto" : "Seg.Manual"); }
            Theme.Use(btnMic, "Toggle.Live");

            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // Sendezeile wie die Kopfzeile des Web-Studios: ON-AIR-Anzeige, Betriebsart (.mode-switch), MIC LIVE, Sendung
            onAirPill.Child = Kit.H(dot, onAir);
            var modeSwitch = new Border
            {
                CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), BorderBrush = Kit.Line, Background = Theme.Solid(Theme.C("#CC06152A")),
                Margin = new Thickness(12, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center, Child = Kit.H(btnManual, new Border { Width = 1, Background = Kit.Line }, btnAuto),
            };
            modeSwitch.Loaded += (s, e) => modeSwitch.Clip = new RectangleGeometry(new Rect(0, 0, modeSwitch.ActualWidth, modeSwitch.ActualHeight), 8, 8);
            var header = Kit.Panel(Kit.H(onAirPill, modeSwitch, btnMic, btnStream));
            header.Padding = new Thickness(10, 8, 10, 8);
            Children.Add(header);

            var deckGrid = new UniformGrid { Columns = 4, Margin = new Thickness(-4, -4, -4, 6) };
            foreach (var d in decks) { var card = new DeckCard(d, this); cards.Add(card); deckGrid.Children.Add(card); }
            SetRow(deckGrid, 1);
            Children.Add(deckGrid);

            var lower = new Grid();
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(470) });
            var cartCard = Kit.Card("Cardwall", Kit.Scroll(cartPanel), "Taste klicken = abspielen · Rechtsklick = belegen oder leeren");
            cartCard.Margin = new Thickness(0, 0, 10, 0);
            lower.Children.Add(cartCard);
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
            var qCard = Kit.Card("Warteschlange", qBody);
            SetColumn(qCard, 1);
            lower.Children.Add(qCard);
            SetRow(lower, 2);
            Children.Add(lower);

            watch.Tick += (s, e) => { if (IsVisible && C.Connected) _ = RefreshQuiet(); };
            tick.Tick += (s, e) => { foreach (var d in decks) d.Tick(500); };
            tick.Start();
            watch.Start();
        }

        // ---------- Laden ----------

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var lib = C.Api.Library(C.StationId);
                var carts = C.Api.Cardwall(C.StationId);
                var mode = C.Api.Mode(C.StationId);
                var playout = C.Api.Playout(C.StationId);
                await Task.WhenAll(lib, carts, mode, playout);
                library = lib.Result.Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                ApplyCarts(carts.Result);
                ApplyMode(mode.Result);
                await ApplyPlayout(playout.Result);
                await LoadQueue();
                loaded = true;
            }, "Studio laden");
        }

        async Task RefreshQuiet()
        {
            try
            {
                var mode = C.Api.Mode(C.StationId);
                var playout = C.Api.Playout(C.StationId);
                await Task.WhenAll(mode, playout);
                ApplyMode(mode.Result);
                await ApplyPlayout(playout.Result);
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
                        break;
                    case "cardwall.changed":
                    case "cardwall.triggered":
                        ApplyCarts(await C.Api.Cardwall(C.StationId));
                        break;
                    case "deck.state_changed":
                    case "playout.state":
                        await ApplyPlayout(await C.Api.Playout(C.StationId));
                        break;
                    case "automation.state_changed":
                    case "station.changed":
                        ApplyMode(await C.Api.Mode(C.StationId));
                        await ApplyPlayout(await C.Api.Playout(C.StationId));
                        break;
                    case "queue.changed":
                        await LoadQueue();
                        break;
                }
            }
            catch { /* das nächste Ereignis oder der 3-s-Abgleich korrigiert es */ }
        }

        void ApplyMode(ModeView m)
        {
            if (m == null) return;
            btnAuto.IsChecked = m.Base == "AUTO";
            btnManual.IsChecked = m.Base == "MANUAL";
            var live = m.mode == "LIVE";
            var c = live ? Theme.C("#EF4444") : m.mode == "EMERGENCY" ? Theme.C("#F59E0B") : Theme.C("#22C55E");
            dot.Fill = Theme.Solid(c);
            onAir.Foreground = Theme.Solid(live ? Theme.C("#FECACA") : m.mode == "EMERGENCY" ? Theme.C("#FDE68A") : Theme.C("#86EFAC"));
            onAirPill.BorderBrush = Theme.Solid(Theme.Alpha(c, 0.55));
            onAirPill.Background = Theme.Solid(Theme.Alpha(c, 0.14));
            onAir.Text = live ? "ON AIR · LIVE · " + m.live : m.mode == "EMERGENCY" ? "ON AIR · NOTFALL" : "ON AIR · " + m.mode;
        }

        async Task ApplyPlayout(PlayoutView p)
        {
            busRunning = p?.status?.running == true;
            micOn = p?.status?.micOn == true;
            btnMic.IsChecked = micOn;
            ((Button)btnStream).Content = busRunning ? "Sendung stoppen" : "Sendung starten";

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

        // ---------- Kopfzeile ----------

        async Task SetMode(string mode)
        {
            await C.Run(async () => ApplyMode(await C.Api.SetMode(C.StationId, mode)), "Betriebsart");
        }

        async Task ToggleMic()
        {
            await C.Run(async () => { await C.Api.SetMic(C.StationId, !micOn); await ApplyPlayout(await C.Api.Playout(C.StationId)); }, "Mikrofon");
        }

        async Task ToggleStream()
        {
            await C.Run(async () =>
            {
                if (busRunning)
                {
                    if (!Dlg.Confirm(C.Owner, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.")) return;
                    await ApplyPlayout(await C.Api.StopPlayout(C.StationId));
                }
                else await ApplyPlayout(await C.Api.StartPlayout(C.StationId));
            }, "Sendung");
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
                    Width = 150, Height = 64, Margin = new Thickness(4), Padding = new Thickness(10, 6, 10, 6),
                    Background = has ? Theme.Linear(160, (Theme.Mix(color, 0.72, Theme.C("#0D1424")), 0), (Theme.Mix(color, 0.5, Theme.C("#0D1424")), 1)) : (Brush)Brushes.Transparent,
                    BorderBrush = has ? Theme.Solid(Theme.Alpha(color, 0.8)) : Kit.Line2, Foreground = has ? Brushes.White : Kit.Muted,
                    Content = new TextBlock { Text = string.IsNullOrEmpty(s.label) ? (has ? "Cart" : "leer") : s.label, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontWeight = has ? FontWeights.Bold : FontWeights.Normal },
                };
                b.Click += async (o, e) => { if (has) await C.Run(() => C.Api.TriggerCart(C.StationId, s.id), "Cart"); };
                var menu = new ContextMenu();
                var assign = new MenuItem { Header = "Titel zuweisen …" };
                assign.Click += async (o, e) => await AssignCart(s);
                var clear = new MenuItem { Header = "Leeren" };
                clear.Click += async (o, e) => await C.Run(async () => { await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = (string)null, label = "" }); ApplyCarts(await C.Api.Cardwall(C.StationId)); }, "Cart");
                menu.Items.Add(assign);
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

        // ---------- Warteschlange ----------

        async Task LoadQueue()
        {
            var q = await C.Api.GetJ(C.St("/queue"));
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
