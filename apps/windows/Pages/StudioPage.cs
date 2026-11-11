// Studio: Betriebsart, On-Air, Mikrofon, die vier Decks (A–D), Cardwall und Warteschlange - die Bedienung im Sendebetrieb.
// Die Felder unter den Decks liegen frei auf einem Raster (am Kopf verschieben, an der Ecke ◢ die Größe ändern; je Gerät
// gespeichert), Titel lassen
// sich aus Archiv und Warteschlange auf Decks, Warteschlange und Carts ziehen. Schnellzugriff und Voicetrack richten sich
// danach, wer das Programm macht: die eigene Automation (AnMaCha Cast) oder laut.fm.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Audio;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;
using AnMaChaCast.ViewModels;

namespace AnMaChaCast.Pages
{
    sealed class StudioPage : View
    {
        static readonly string[] DeckIds = { "A", "B", "C", "D" };
        /// <summary>Datenformate beim Ziehen: Titel (Medien-IDs, je Zeile eine) bzw. ein Eintrag der Warteschlange (uid⇥mediaId).</summary>
        internal const string MediaFormat = "AnMaChaCast.Media";
        internal const string QueueFormat = "AnMaChaCast.QueueItem";
        static readonly string LayoutFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast", "studio-layout.txt");

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
        readonly TextBlock programInfo = Kit.Text("", 12, false, Kit.Muted, true);
        readonly CheckBox autoFill = new CheckBox { Content = "Nach Sendeuhr auffüllen", Margin = new Thickness(0, 6, 0, 0) };
        readonly UniformGrid deckGrid = new UniformGrid { Columns = 4, Margin = new Thickness(-4, -4, -4, 6) };
        readonly Canvas board = new Canvas { ClipToBounds = false };
        readonly Grid content = new Grid();
        bool settingFill;
        int slowTicks;

        // frei anordenbare Felder auf dem Raster (12 Spalten, Zeilen zu RowH Pixeln)
        const double RowH = 40, Gap = 10;
        StudioLayout layout;
        readonly Dictionary<string, Border> panels = new Dictionary<string, Border>();
        bool stacked;
        // laufendes Verschieben/Größe ändern: Feld, Art, Startpunkt der Maus, Layout beim Start
        string dragId;
        bool dragResize;
        Point dragStart;
        StudioLayout dragBase;
        bool allowBringIntoView;

        // laut.fm oder eigene Automation
        bool lautfmLinked;
        string mode = "own"; // own | lautfm | cast
        readonly HashSet<string> ensuredLautfm = new HashSet<string>();
        List<(int Id, string Title)> lautJingles;
        readonly UniformGrid quick = new UniformGrid { Columns = 2 };

        // Voicetrack
        readonly VoiceRecorder recorder = new VoiceRecorder();
        readonly DispatcherTimer meterTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        readonly ComboBox micDevice = new ComboBox { MinWidth = 160, DisplayMemberPath = "Name", Margin = new Thickness(3) };
        readonly TextBox vtTitle = Kit.Box("", 160);
        readonly ProgressBar vtMeter = new ProgressBar { Height = 8, Minimum = 0, Maximum = 1, Margin = new Thickness(3, 6, 3, 4), BorderThickness = new Thickness(0) };
        readonly TextBlock vtState = Kit.Text("Bereit", 12, false, Kit.Muted, true);
        Button vtRecord, vtPlay, vtQueue, vtDiscard;

        public StudioPage(Ctx c) : base(c)
        {
            // ON AIR, Betriebsart, MIC LIVE, Mithören und Sendung liegen wie im Web-Studio in der Kopfzeile (Ui/OnAirBar.cs).
            content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            // Ein angeklickter/gezogener Titel (oder ein Knopf) soll die Seite nicht verschieben: WPF holt das Element sonst
            // „ins Bild“ und scrollt dabei nach unten. Nur gewollte Sprünge (Voicetrack-Hinweis) sind erlaubt.
            content.RequestBringIntoView += (s, e) => { if (!allowBringIntoView) e.Handled = true; };
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
            Add("carts", "Cardwall", Kit.Scroll(cartPanel), "Klick = abspielen · Titel hierher ziehen = belegen · Rechtsklick = belegen, Taste zuweisen oder leeren · F1–F4 = Decks · Esc = alle Carts stoppen");

            // Playlist / Archiv: suchen, einreihen, auf ein Deck legen (auch per Ziehen), ganze Playlist spielen
            search.TextChanged += (s, e) => FillArchive();
            archive.MouseDoubleClick += async (s, e) => await EnqueueSelected();
            DragSource(archive, MediaFormat, () => string.Join("\n", archive.Many.Select(r => J.Str(r.El, "id"))));
            var archiveBody = new DockPanel();
            var archiveTop = Kit.V(
                Kit.Wrap(Kit.Text("Suchen"), search, Kit.Btn("Einreihen", EnqueueSelected, "Markierte Titel in die Warteschlange (Doppelklick oder ziehen)", true),
                    Kit.Btn("Auf Deck A", () => ToDeck("A")), Kit.Btn("B", () => ToDeck("B")), Kit.Btn("C", () => ToDeck("C")), Kit.Btn("D", () => ToDeck("D"))),
                Kit.Wrap(Kit.Text("Playlist"), playlists, Kit.Btn("Playlist spielen", PlayPlaylist, "Die gewählte Playlist in die Warteschlange übernehmen")));
            DockPanel.SetDock(archiveTop, Dock.Top);
            archiveBody.Children.Add(archiveTop);
            archiveBody.Children.Add(archive);
            Add("archive", "Playlist / Archiv", archiveBody, "Titel auf ein Deck, in die Warteschlange oder auf eine Cart ziehen");

            // Warteschlange: Titel hineinziehen (an die Stelle unter der Maus), Einträge umsortieren oder auf ein Deck ziehen
            var qBody = new Grid();
            qBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            qBody.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            qBody.Children.Add(queue);
            DragSource(queue, QueueFormat, () => queue.One == null ? null : J.Str(queue.One.El, "uid") + "\t" + J.Str(queue.One.El, "mediaId"));
            queue.AllowDrop = true;
            queue.DragOver += (s, e) =>
            {
                if (e.Data.GetDataPresent(MediaFormat)) e.Effects = DragDropEffects.Copy;
                else if (e.Data.GetDataPresent(QueueFormat)) e.Effects = DragDropEffects.Move;
                else return;
                e.Handled = true;
            };
            queue.Drop += async (s, e) =>
            {
                if (!e.Data.GetDataPresent(MediaFormat) && !e.Data.GetDataPresent(QueueFormat)) return;
                e.Handled = true;
                var index = RowIndexAt(queue, e);
                if (e.Data.GetData(MediaFormat) is string ids) await EnqueueIds(ids.Split('\n').Where(x => x.Length > 0).ToList(), index);
                else if (e.Data.GetData(QueueFormat) is string q) await MoveQueueItem(q.Split('\t')[0], index);
            };
            var qButtons = Kit.Wrap(
                Kit.Btn("Titel einreihen …", AddToQueue),
                Kit.Btn("Entfernen", RemoveFromQueue),
                Kit.Btn("▲", () => MoveInQueue(-1), "Nach oben (oder ziehen)"),
                Kit.Btn("▼", () => MoveInQueue(1), "Nach unten (oder ziehen)"),
                Kit.Btn("Mischen", () => QueueAction("shuffle")),
                Kit.Btn("Auffüllen", () => QueueAction("fill"), "Aus der Rotation auffüllen"),
                Kit.Btn("Leeren", ClearQueue));
            Grid.SetRow(qButtons, 1);
            qBody.Children.Add(qButtons);
            Add("queue", "Warteschlange", qBody);

            // Automation: Zustand, wer das Programm macht (eigene Automation oder laut.fm), Start/Weiter/Stop
            autoFill.Click += async (s, e) => { if (!settingFill) await C.Run(() => C.Api.PatchJ(C.St("/automation"), new { autoFill = autoFill.IsChecked == true }), "Sendeuhr"); };
            Add("automation", "Automation 24/7", Kit.V(autoState, programInfo,
                Kit.Wrap(Kit.Btn("Start", StartAutomation, "Server-Playout starten", true), Kit.Btn("Weiter ⏭", () => C.Run(() => C.Api.PostJ(C.St("/playout/skip")), "Weiter"), "Nächsten Titel sofort"), Kit.Btn("Stop", StopAutomation)),
                autoFill), null, true);

            BuildQuick();
            Add("quick", "Schnellzugriff", Kit.V(quick, Kit.Wrap(Kit.Btn("■ Alle Carts stoppen", () => C.Run(() => C.Api.PostJ(C.St("/playout/carts-stop")), "Carts"), "Laufende Jingles/Carts sofort stoppen"))),
                "Klick = spielen · ▾ = gezielt auswählen", true);
            // schmales Feld: Kacheln untereinander, damit die Beschriftung lesbar bleibt
            quick.SizeChanged += (s, e) => { if (e.WidthChanged) quick.Columns = e.NewSize.Width < 300 ? 1 : 2; };

            BuildVoicetrack();

            encoders.MinHeight = 90;
            encoders.MouseDoubleClick += async (s, e) => await ToggleEncoder();
            var encMenu = new ContextMenu();
            var encEdit = new MenuItem { Header = "Bearbeiten …" };
            encEdit.Click += async (s, e) => { if (encoders.One != null && await EncoderDialogs.Edit(C, encoders.One.El)) await LoadSide(); };
            var encDel = new MenuItem { Header = "Entfernen" };
            encDel.Click += async (s, e) =>
            {
                var r = encoders.One;
                if (r == null || !Dlg.Confirm(C.Owner, "Encoder „" + J.Str(r.El, "name") + "“ entfernen?")) return;
                await C.Run(async () => { await C.Api.DeleteJ(C.St("/outputs/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await LoadSide(); }, "Encoder");
            };
            encMenu.Items.Add(encEdit);
            encMenu.Items.Add(encDel);
            EncoderDialogs.AddLautFmLinks(C, encMenu, () => encoders.One?.El);
            encoders.ContextMenu = encMenu;
            Button addEnc = null;
            addEnc = Kit.Btn("+ Encoder", () => EncoderDialogs.ShowAddMenu(C, addEnc, lautfmLinked, LoadSide), "Weiteren Stream hinzufügen: laut.fm, andere laut.fm-Station oder Icecast/SHOUTcast – alle verbundenen senden gleichzeitig");
            var encBody = new DockPanel();
            var encButtons = Kit.V(
                Kit.Wrap(Kit.Btn("Verbinden / Trennen", ToggleEncoder, "Markierten Encoder verbinden oder trennen (Doppelklick)", true), addEnc),
                Kit.Wrap(Kit.Btn("Alle verbinden", () => SetAllEncoders(true)), Kit.Btn("Alle trennen", () => SetAllEncoders(false))));
            DockPanel.SetDock(encButtons, Dock.Bottom);
            encBody.Children.Add(encButtons);
            encBody.Children.Add(encoders);
            Add("encoders", "Stream & Encoder", encBody, "Mehrere Encoder senden gleichzeitig · Rechtsklick = bearbeiten/entfernen");

            layout = LoadLayout();
            board.Margin = new Thickness(0, 0, 0, 10);
            Grid.SetRow(board, 1);
            content.Children.Add(board);
            foreach (var card in panels.Values) board.Children.Add(card);
            board.SizeChanged += (s, e) => { if (e.WidthChanged) Place(); };
            SizeChanged += (s, e) => deckGrid.Columns = e.NewSize.Width < 860 ? 2 : 4; // Laptop (1366×768, 125 %) bleibt vierspaltig
            Place();

            watch.Tick += (s, e) => { if (IsVisible && C.Connected) _ = RefreshQuiet(); };
            tick.Tick += (s, e) => { foreach (var d in decks) d.Tick(500); };
            meterTimer.Tick += (s, e) => UpdateRecorder();
            tick.Start();
            watch.Start();
        }

        /// <summary>Zum unteren Teil (Felder unter den Decks) bzw. wieder nach oben scrollen – für die Build-Screenshots.</summary>
        public bool ScrollToLower(bool down = true)
        {
            if (!(Children.Count > 0 && Children[0] is ScrollViewer sv) || sv.ScrollableHeight <= 0) return false;
            sv.ScrollToVerticalOffset(down ? Math.Min(sv.ScrollableHeight, Math.Max(0, deckGrid.ActualHeight - 10)) : 0);
            return true;
        }

        static readonly (string Cat, string Label)[] Quick =
        {
            ("news", "News"), ("jingle", "Jingle"), ("ad", "Werbung"), ("station_id", "Station ID"),
            ("voice_track", "Voice Track"), ("sweeper", "Sweeper"), ("drop", "Drop"), ("tts", "TTS"),
        };
        static readonly HashSet<string> JingleLike = new HashSet<string> { "jingle", "station_id", "sweeper", "drop" };

        // ---------- Felder & Layout ----------

        /// <summary>Feld anlegen: Karte wie im Web-Studio. Am Kopf ziehen = verschieben, an der Ecke ◢ ziehen = Größe ändern.</summary>
        void Add(string id, string title, UIElement body, string hint = null, bool scroll = false)
        {
            // Felder ohne eigene Liste scrollen, wenn sie kleiner gezogen werden als ihr Inhalt (statt ihn abzuschneiden)
            if (scroll) body = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            var card = Kit.Card(title, body, hint);
            card.Margin = new Thickness(0);
            if (card.Child is Grid g && g.Children.Count > 0 && g.Children[0] is Border head && head.Child is TextBlock text)
            {
                head.Child = null;
                var grip = Kit.Icon("\uE76F", 12, Kit.Muted);
                grip.Margin = new Thickness(8, 0, 0, 0);
                var dock = new DockPanel { Background = Brushes.Transparent };
                DockPanel.SetDock(grip, Dock.Right);
                dock.Children.Add(grip);
                dock.Children.Add(text);
                head.Child = dock;
                head.Background = Brushes.Transparent;
                head.Cursor = Cursors.SizeAll;
                head.ToolTip = "Ziehen: Feld frei verschieben · Ecke ◢ unten rechts: Größe ändern · Rechtsklick: Layout zurücksetzen";
                BeginDrag(head, id, false);
                var menu = new ContextMenu();
                var reset = new MenuItem { Header = "Layout zurücksetzen" };
                reset.Click += (s, e) => { layout = StudioLayout.Default(); SaveLayout(); Place(); C.Ok("Studio-Layout zurückgesetzt"); };
                menu.Items.Add(reset);
                head.ContextMenu = menu;

                var corner = new Border
                {
                    Width = 18, Height = 18, Background = Brushes.Transparent, Cursor = Cursors.SizeNWSE, ToolTip = "Ziehen: Größe ändern",
                    HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, -10, -10),
                    Child = new TextBlock { Text = "◢", FontSize = 12, Foreground = Kit.Muted, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 3, 1) },
                };
                Grid.SetRowSpan(corner, 3);
                Panel.SetZIndex(corner, 10);
                g.Children.Add(corner);
                BeginDrag(corner, id, true);
            }
            panels[id] = card;
        }

        /// <summary>Verschieben bzw. Größe ändern mit der Maus: rastet live auf das Raster ein, andere Felder weichen nach unten aus.</summary>
        void BeginDrag(FrameworkElement handle, string id, bool resize)
        {
            handle.MouseLeftButtonDown += (s, e) =>
            {
                if (stacked) { C.Status("Felder verschieben geht im breiteren Fenster (hier stehen sie untereinander)", true); return; }
                dragId = id; dragResize = resize; dragStart = e.GetPosition(board); dragBase = layout.Clone();
                handle.CaptureMouse();
                Panel.SetZIndex(panels[id], 5);
                Highlight(panels[id], true);
                e.Handled = true;
            };
            handle.MouseMove += (s, e) =>
            {
                if (dragId != id || !handle.IsMouseCaptured) return;
                var p = e.GetPosition(board);
                var cell = CellW();
                var dx = (int)Math.Round((p.X - dragStart.X) / cell);
                var dy = (int)Math.Round((p.Y - dragStart.Y) / RowH);
                var b = dragBase.Get(id);
                var next = dragBase.Clone();
                var changed = resize ? next.Resize(id, b.W + dx, b.H + dy) : next.Move(id, b.X + dx, b.Y + dy);
                if (!changed && next.Serialize() == layout.Serialize()) return;
                layout = next;
                Place();
            };
            handle.MouseLeftButtonUp += (s, e) =>
            {
                if (dragId != id) return;
                handle.ReleaseMouseCapture();
                dragId = null;
                Panel.SetZIndex(panels[id], 0);
                Highlight(panels[id], false);
                SaveLayout();
                e.Handled = true;
            };
            handle.LostMouseCapture += (s, e) => { if (dragId == id) { dragId = null; Highlight(panels[id], false); Panel.SetZIndex(panels[id], 0); SaveLayout(); } };
        }

        double CellW() => Math.Max(20, (board.ActualWidth + Gap) / StudioLayout.Cols);

        static void Highlight(Border card, bool on)
        {
            card.BorderBrush = on ? Kit.Accent : Kit.PanelLine;
            card.BorderThickness = new Thickness(on ? 2 : 1);
        }

        static StudioLayout LoadLayout()
        {
            try { return File.Exists(LayoutFile) ? StudioLayout.Parse(File.ReadAllText(LayoutFile)) : StudioLayout.Default(); }
            catch (IOException) { return StudioLayout.Default(); }
            catch (UnauthorizedAccessException) { return StudioLayout.Default(); }
        }

        void SaveLayout()
        {
            try { Directory.CreateDirectory(Path.GetDirectoryName(LayoutFile)); File.WriteAllText(LayoutFile, layout.Serialize()); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        /// <summary>Felder nach dem Raster platzieren. Schmale Fenster (unter 760 px): alle untereinander in voller Breite.</summary>
        void Place()
        {
            var width = board.ActualWidth;
            if (width <= 0) width = 1100;
            stacked = width < 760;
            var boxes = stacked ? layout.Stacked() : layout.Boxes;
            var cell = stacked ? (width + Gap) / StudioLayout.Cols : CellW();
            foreach (var b in boxes)
            {
                var card = panels[b.Id];
                Canvas.SetLeft(card, b.X * cell);
                Canvas.SetTop(card, b.Y * RowH);
                card.Width = Math.Max(60, b.W * cell - Gap);
                card.Height = Math.Max(60, b.H * RowH - Gap);
            }
            board.Height = boxes.Count == 0 ? 0 : boxes.Max(b => b.Y + b.H) * RowH;
        }

        void BringPanel(string id)
        {
            allowBringIntoView = true;
            try { panels[id].BringIntoView(); } finally { allowBringIntoView = false; }
        }

        // ---------- Ziehen & Ablegen von Titeln ----------

        /// <summary>Zeilen einer Tabelle ziehbar machen (Daten aus payload, null = nichts zu ziehen).</summary>
        static void DragSource(Table t, string format, Func<string> payload)
        {
            Point? down = null;
            t.PreviewMouseLeftButtonDown += (s, e) => down = OnRow(e.OriginalSource as DependencyObject) ? e.GetPosition(t) : (Point?)null;
            t.PreviewMouseLeftButtonUp += (s, e) => down = null;
            t.PreviewMouseMove += (s, e) =>
            {
                if (down == null || e.LeftButton != MouseButtonState.Pressed) return;
                var p = e.GetPosition(t);
                if (Math.Abs(p.X - down.Value.X) < SystemParameters.MinimumHorizontalDragDistance && Math.Abs(p.Y - down.Value.Y) < SystemParameters.MinimumVerticalDragDistance) return;
                down = null;
                var data = payload();
                if (string.IsNullOrEmpty(data)) return;
                DragDrop.DoDragDrop(t, new DataObject(format, data), DragDropEffects.Copy | DragDropEffects.Move);
            };
        }

        static bool OnRow(DependencyObject d)
        {
            while (d != null && !(d is Table))
            {
                if (d is ListViewItem) return true;
                d = d is Visual || d is System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(d) : LogicalTreeHelper.GetParent(d);
            }
            return false;
        }

        /// <summary>Index der Zeile unter der Maus (Ende der Liste, wenn darunter).</summary>
        static int RowIndexAt(Table t, DragEventArgs e)
        {
            var d = t.InputHitTest(e.GetPosition(t)) as DependencyObject;
            while (d != null && !(d is ListViewItem)) d = d is Visual ? VisualTreeHelper.GetParent(d) : null;
            if (d is ListViewItem item)
            {
                var i = t.ItemContainerGenerator.IndexFromContainer(item);
                if (i >= 0) return e.GetPosition(item).Y > item.ActualHeight / 2 ? i + 1 : i;
            }
            return t.Items.Count;
        }

        /// <summary>Titel oder Warteschlangen-Eintrag auf ein Deck gezogen.</summary>
        public async Task DropOnDeck(DeckViewModel d, IDataObject data)
        {
            if (data.GetData(MediaFormat) is string ids)
            {
                var id = ids.Split('\n').FirstOrDefault(x => x.Length > 0);
                if (id != null) await DeckAction(d, "load", new { mediaId = id });
            }
            else if (data.GetData(QueueFormat) is string q)
            {
                var parts = q.Split('\t');
                if (parts.Length < 2 || parts[1].Length == 0) return;
                // aus der Warteschlange aufs Deck: dort laden und aus der Warteschlange nehmen (nicht doppelt spielen)
                await C.Run(async () =>
                {
                    await C.Api.DeckAction(C.StationId, d.Id, "load", new { mediaId = parts[1] });
                    await C.Api.DeleteJ(C.St("/queue/" + Uri.EscapeDataString(parts[0])));
                    _ = RefreshQuiet();
                    await LoadQueue();
                }, "Deck " + d.Id);
            }
        }

        async Task EnqueueIds(List<string> ids, int index)
        {
            if (ids.Count == 0) return;
            await C.Run(async () =>
            {
                for (var i = 0; i < ids.Count; i++) await C.Api.PostJ(C.St("/queue"), new { mediaId = ids[i], index = index + i });
                await LoadQueue();
                C.Ok(ids.Count == 1 ? "Eingereiht: " + (library.TryGetValue(ids[0], out var m) ? m.title : ids[0]) : ids.Count + " Titel eingereiht");
            }, "Warteschlange");
        }

        async Task MoveQueueItem(string uid, int index)
        {
            var from = queue.Items.Cast<Row>().ToList().FindIndex(r => J.Str(r.El, "uid") == uid);
            if (from < 0) return;
            if (index > from) index--; // der Eintrag selbst fällt beim Verschieben aus der Zählung
            if (index == from) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + Uri.EscapeDataString(uid) + "/move"), new { index }); await LoadQueue(); }, "Warteschlange");
        }

        // ---------- Laden ----------

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            lautJingles = null;
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
                await LoadLautfmLink();
                await LoadSide();
                await LoadPlaylists();
                await EnsureLautfmEncoder();
                UpdateQuick();
                loaded = true;
            }, "Studio laden");
            if (micDevice.Items.Count == 0) FillMics();
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
                        UpdateQuick();
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
                    case "outputs.changed":
                    case "output.state_changed":
                        await LoadSide();
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

        /// <summary>Deck-Aktion: Zustand sofort anzeigen (der Klick fühlt sich direkt an), dann an den Server; den genauen
        /// Stand liefern das Ereignis vom Server bzw. der Abgleich im Hintergrund – ohne auf eine zweite Antwort zu warten.</summary>
        public Task DeckAction(DeckViewModel d, string action, object body = null)
        {
            var before = d.Status;
            if (action == "play" && d.HasMedia) d.Status = "playing";
            else if (action == "pause" && d.IsPlaying) d.Status = "paused";
            else if (action == "stop" && d.HasMedia) { d.Status = "cued"; d.PositionMs = 0; }
            return C.Run(async () =>
            {
                try { await C.Api.DeckAction(C.StationId, d.Id, action, body); }
                catch { d.Status = before; throw; }
                _ = RefreshQuiet();
            }, "Deck " + d.Id);
        }

        public Task Skip(DeckViewModel d, int deltaMs)
        {
            var target = Math.Max(0, d.PositionMs + deltaMs);
            d.PositionMs = target;
            return C.Run(() => C.Api.DeckAction(C.StationId, d.Id, "seek", new { ms = target }), "Deck " + d.Id);
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
            foreach (var slot in carts)
            {
                var s = slot;
                Color color;
                try { color = Theme.C(string.IsNullOrEmpty(s.color) ? "#38BDF8" : s.color); } catch (Exception ex) when (ex is FormatException || ex is NotSupportedException) { color = Theme.C("#38BDF8"); }
                var has = !string.IsNullOrEmpty(s.mediaId);
                // .cart: Verlauf in der Cart-Farbe, freie Tasten nur mit feinem Rahmen
                var b = new Button
                {
                    Height = 64, Margin = new Thickness(4), Padding = new Thickness(10, 6, 10, 6), AllowDrop = true,
                    Background = has ? Theme.Linear(160, (Theme.Mix(color, 0.72, Theme.C("#0D1424")), 0), (Theme.Mix(color, 0.5, Theme.C("#0D1424")), 1)) : (Brush)Brushes.Transparent,
                    BorderBrush = has ? Theme.Solid(Theme.Alpha(color, 0.8)) : Kit.Line2, Foreground = has ? Brushes.White : Kit.Muted,
                    Content = new TextBlock { Text = (string.IsNullOrEmpty(s.label) ? (has ? "Cart" : "leer") : s.label) + (has && !string.IsNullOrEmpty(s.hotkey) ? "  [" + s.hotkey.ToUpperInvariant() + "]" : ""), TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontWeight = has ? FontWeights.Bold : FontWeights.Normal },
                };
                b.Click += async (o, e) => { if (has) await C.Run(() => C.Api.TriggerCart(C.StationId, s.id), "Cart"); };
                // Titel aus dem Archiv auf die Cart ziehen = belegen (Beschriftung = Titel)
                b.DragOver += (o, e) => { if (e.Data.GetDataPresent(MediaFormat)) { e.Effects = DragDropEffects.Copy; e.Handled = true; } };
                b.Drop += async (o, e) =>
                {
                    if (!(e.Data.GetData(MediaFormat) is string ids)) return;
                    e.Handled = true;
                    var id = ids.Split('\n').FirstOrDefault(x => x.Length > 0);
                    if (id == null) return;
                    var title = library.TryGetValue(id, out var m) ? m.title : "Cart";
                    await C.Run(async () => { await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = id, label = title }); ApplyCarts(await C.Api.Cardwall(C.StationId)); C.Ok("Cart belegt: " + title); }, "Cart");
                };
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
        public bool HandleKey(Key key, bool typing)
        {
            if (!C.Connected) return false;
            if (key >= Key.F1 && key <= Key.F4)
            {
                var d = decks[key - Key.F1];
                _ = DeckAction(d, d.IsPlaying ? "pause" : "play");
                return true;
            }
            if (typing) return false;
            if (key == Key.Escape)
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

        static string KeyChar(Key key)
        {
            if (key >= Key.A && key <= Key.Z) return ((char)('a' + (key - Key.A))).ToString();
            if (key >= Key.D0 && key <= Key.D9) return ((char)('0' + (key - Key.D0))).ToString();
            if (key >= Key.NumPad0 && key <= Key.NumPad9) return ((char)('0' + (key - Key.NumPad0))).ToString();
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

        Task EnqueueSelected()
        {
            var rows = archive.Many.ToList();
            if (rows.Count == 0) { C.Status("Bitte einen Titel im Archiv markieren", true); return Task.CompletedTask; }
            return EnqueueIds(rows.Select(r => J.Str(r.El, "id")).ToList(), queue.Items.Count);
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

        // ---------- Automation, Programmquelle, Encoder ----------

        /// <summary>Ist dieser Sender mit einer laut.fm-Station verknüpft?</summary>
        async Task LoadLautfmLink()
        {
            try { lautfmLinked = J.Long(await C.Api.GetJ(C.St("/lautfm")), "stationId") > 0; }
            catch (ApiException) { lautfmLinked = false; }
        }

        /// <summary>laut.fm-Sender gewählt: der laut.fm-Encoder steht automatisch im Live-Studio (getrennt, bis „Verbinden“).</summary>
        async Task EnsureLautfmEncoder()
        {
            if (!lautfmLinked || ensuredLautfm.Contains(C.StationId)) return;
            if ((encoders.ItemsSource as IEnumerable<Row> ?? new Row[0]).Any(r => EncoderDialogs.IsLautFm(r.El))) { ensuredLautfm.Add(C.StationId); return; }
            ensuredLautfm.Add(C.StationId); // einmal je Sitzung versuchen, nicht bei jedem Wechsel erneut
            try
            {
                await C.Api.PostJ(C.St("/lautfm/live-output"), new { }, 60);
                await LoadSide();
                C.Ok("laut.fm-Encoder für „" + C.StationName + "“ steht bereit – zum Senden „Verbinden“");
            }
            catch (ApiException ex) when (ex.Status == 403) { /* ohne Encoder-Recht: still, das Feld zeigt die vorhandenen */ }
            catch (ApiException ex) { C.Status("laut.fm-Encoder konnte nicht automatisch angelegt werden: " + ex.Message, true); }
        }

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
            {
                var sel = encoders.One == null ? null : J.Str(encoders.One.El, "id");
                var rows = J.Arr(outs.Result).Select(x => new Row(x, J.Str(x, "name"), OutputsPage.EncoderState(x))).ToList();
                encoders.Set(rows);
                if (sel != null) encoders.SelectedItem = rows.FirstOrDefault(r => J.Str(r.El, "id") == sel);
                // Wer macht das Programm? laut.fm-Sender ohne eigene Live-Verbindung zu laut.fm = laut.fm-Automation
                var castLive = rows.FirstOrDefault(r => EncoderDialogs.IsLautFm(r.El) && J.Bool(r.El, "enabled", true) && J.Str(r.El, "state.status") == "connected");
                var next = !lautfmLinked ? "own" : castLive != null ? "cast" : "lautfm";
                programInfo.Text = next == "lautfm" ? "Programm: laut.fm-Automation – laut.fm spielt die Playlisten. Schnellzugriff und Voicetrack gehen in die laufende laut.fm-Playlist."
                    : next == "cast" ? "Programm: live auf laut.fm über „" + J.Str(castLive.El, "name") + "“ – eigene Automation, Schnellzugriff aus der Mediathek."
                    : "Programm: eigene Automation (AnMaCha Cast) – Schnellzugriff aus der Mediathek.";
                if (next != mode) { mode = next; UpdateQuick(); UpdateRecorder(); }
            }
        }

        Task StartAutomation() => C.Run(async () => { await C.Api.StartPlayout(C.StationId); await LoadSide(); C.Ok("Automation läuft"); }, "Automation");

        async Task StopAutomation()
        {
            if (!Dlg.Confirm(C.Owner, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.")) return;
            await C.Run(async () => { await C.Api.StopPlayout(C.StationId); await LoadSide(); }, "Automation");
        }

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

        // ---------- Schnellzugriff ----------

        readonly Dictionary<string, (Button Main, Button More, TextBlock Text)> quickTiles = new Dictionary<string, (Button, Button, TextBlock)>();

        void BuildQuick()
        {
            foreach (var (cat, label) in Quick)
            {
                var c = cat;
                var text = new TextBlock { Text = label, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
                var main = Kit.Btn(label, () => QuickMain(c, label));
                main.Content = text;
                main.Margin = new Thickness(3, 3, 0, 3);
                main.HorizontalContentAlignment = HorizontalAlignment.Left;
                main.Padding = new Thickness(10, 7, 6, 7);
                var more = Kit.Btn("▾", () => { QuickMenu(c, label, quickTiles[c].More); return Task.CompletedTask; }, label + ": gezielt auswählen");
                more.Margin = new Thickness(1, 3, 3, 3);
                more.Padding = new Thickness(7, 7, 7, 7);
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.Children.Add(main);
                Grid.SetColumn(more, 1);
                g.Children.Add(more);
                quick.Children.Add(g);
                quickTiles[c] = (main, more, text);
            }
        }

        /// <summary>Beschriftung (mit Anzahl) und Hinweise je nach Programmquelle aktualisieren.</summary>
        void UpdateQuick()
        {
            foreach (var (cat, label) in Quick)
            {
                var t = quickTiles[cat];
                var count = library.Values.Count(m => m.category == cat);
                if (mode == "lautfm")
                {
                    var ok = JingleLike.Contains(cat) || cat == "news" || cat == "tts" || cat == "voice_track";
                    t.Text.Text = label;
                    t.Main.IsEnabled = ok;
                    t.More.IsEnabled = JingleLike.Contains(cat);
                    t.Main.ToolTip = JingleLike.Contains(cat) ? label + ": einen laut.fm-Jingle an die laufende laut.fm-Playlist hängen (▾ = auswählen)"
                        : cat == "news" ? "Nachrichten: von der KI erstellen und in die laufende laut.fm-Playlist einreihen"
                        : cat == "tts" ? "Sender-Ansage: von der KI sprechen lassen und in die laufende laut.fm-Playlist einreihen"
                        : cat == "voice_track" ? "Voice Track: im Feld „Voicetrack“ aufnehmen – geht in die laufende laut.fm-Playlist"
                        : "Werbung gibt es nur mit der eigenen Automation (AnMaCha Cast)";
                }
                else
                {
                    t.Text.Text = label + (count > 0 ? "  · " + count : "");
                    t.Main.IsEnabled = true;
                    t.More.IsEnabled = true;
                    t.Main.ToolTip = count == 0 ? label + ": noch keine Titel dieser Art – über ▾ hochladen"
                        : new[] { "news", "ad", "voice_track" }.Contains(cat) ? label + ": nächster aus der Rotation, sofort per Crossfade" : label + ": nächster aus der Rotation, über der Musik";
                }
            }
        }

        async Task QuickMain(string cat, string label)
        {
            if (mode == "lautfm")
            {
                if (cat == "voice_track") { BringPanel("voicetrack"); C.Ok("Voicetrack: aufnehmen, anhören, einreihen"); return; }
                if (cat == "news" || cat == "tts")
                {
                    await C.Run(async () =>
                    {
                        await C.Api.PostJ(C.St("/programmchef/spots/produce"), new { kind = cat == "news" ? "nachrichten" : "ansage" }, 30);
                        C.Ok((cat == "news" ? "Nachrichten" : "Sender-Ansage") + " wird erstellt und in die laufende laut.fm-Playlist eingereiht");
                    }, label);
                    return;
                }
                var list = await LautJingles();
                if (list == null) return;
                if (list.Count == 0) { C.Status("Keine laut.fm-Jingles gefunden – bei laut.fm eigene Titel als „Jingle“ kennzeichnen", true); return; }
                var pick = list[new Random().Next(list.Count)];
                await LautJingleNow(pick.Id, pick.Title);
                return;
            }
            if (cat == "voice_track" && !library.Values.Any(m => m.category == cat)) { BringPanel("voicetrack"); C.Status("Noch keine Voicetracks – im Feld „Voicetrack“ aufnehmen", true); return; }
            await C.Run(async () =>
            {
                var m = await C.Api.PostJ(C.St("/quick/" + cat), new { });
                C.Ok(label + ": " + J.Str(m, "title", "läuft"));
            }, label);
        }

        /// <summary>▾: gezielt einen Titel wählen (eigene Automation: Mediathek dieser Kategorie, laut.fm: Jingles bei laut.fm).</summary>
        async void QuickMenu(string cat, string label, FrameworkElement anchor)
        {
            var menu = new ContextMenu { PlacementTarget = anchor, Placement = PlacementMode.Bottom, MaxHeight = 420 };
            if (mode == "lautfm")
            {
                var list = await LautJingles();
                if (list == null) return;
                foreach (var j in list.Take(60))
                {
                    var mi = new MenuItem { Header = j.Title };
                    var jj = j;
                    mi.Click += async (s, e) => await LautJingleNow(jj.Id, jj.Title);
                    menu.Items.Add(mi);
                }
                if (list.Count == 0) menu.Items.Add(new MenuItem { Header = "Keine laut.fm-Jingles (eigene Titel bei laut.fm als „Jingle“ kennzeichnen)", IsEnabled = false });
            }
            else
            {
                var items = library.Values.Where(m => m.category == cat).OrderBy(m => m.title).Take(60).ToList();
                foreach (var m in items)
                {
                    var mi = new MenuItem { Header = Label(m) };
                    var id = m.id;
                    mi.Click += async (s, e) => await C.Run(async () => { await C.Api.PostJ(C.St("/quick/" + cat), new { mediaId = id }); C.Ok(label + ": " + m.title); }, label);
                    menu.Items.Add(mi);
                }
                if (items.Count == 0) menu.Items.Add(new MenuItem { Header = "Noch keine Titel der Art „" + label + "“", IsEnabled = false });
                menu.Items.Add(new Separator());
                var up = new MenuItem { Header = "Datei als „" + label + "“ hochladen …" };
                up.Click += async (s, e) => await UploadAs(cat, label);
                menu.Items.Add(up);
            }
            menu.IsOpen = true;
        }

        async Task UploadAs(string cat, string label)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Title = label + " hochladen", Multiselect = true, Filter = "Audio|*.mp3;*.wav;*.ogg;*.opus;*.flac;*.m4a;*.aac|Alle Dateien|*.*" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var n = 0;
            foreach (var file in dlg.FileNames)
                if (await C.Run(() => C.Api.UploadFile(C.St("/media?name=" + Uri.EscapeDataString(Path.GetFileName(file)) + "&category=" + cat), file), Path.GetFileName(file))) n++;
            if (n == 0) return;
            library = (await C.Api.Library(C.StationId)).Where(m => m.id != null).ToDictionary(m => m.id, m => m);
            FillArchive();
            UpdateQuick();
            C.Ok(n + " Datei(en) als „" + label + "“ in der Mediathek");
        }

        async Task<List<(int Id, string Title)>> LautJingles()
        {
            if (lautJingles != null) return lautJingles;
            List<(int, string)> list = null;
            await C.Run(async () =>
            {
                C.Status("Lade die Jingles von laut.fm …", false);
                var r = await C.Api.GetJ(C.St("/programmchef/hoerer/jingles/candidates"), 60);
                list = J.Arr(r).Select(x => ((int)J.Long(x, "id"), J.Str(x, "title") + (J.Str(x, "artist").Length > 0 ? " – " + J.Str(x, "artist") : ""))).ToList();
                C.Ok(list.Count + " laut.fm-Jingles");
            }, "laut.fm-Jingles");
            lautJingles = list;
            return list;
        }

        Task LautJingleNow(int id, string title) => C.Run(async () =>
        {
            var r = await C.Api.PostJ(C.St("/programmchef/hoerer/jingles/" + id + "/now"), new { }, 30);
            C.Ok(J.Str(r, "result") == "already" ? "„" + title + "“ steht schon in der laufenden laut.fm-Playlist" : "„" + title + "“ hängt an der laufenden laut.fm-Playlist");
        }, "laut.fm-Jingle");

        // ---------- Voicetrack ----------

        void BuildVoicetrack()
        {
            vtTitle.ToolTip = "Titel des Voicetracks (z. B. „Moderation 14 Uhr“)";
            vtRecord = Kit.Btn("● Aufnehmen", ToggleRecord, "Aufnahme starten/stoppen", true);
            vtPlay = Kit.Btn("▶ Anhören", () => { recorder.TogglePlay(); UpdateRecorder(); return Task.CompletedTask; }, "Aufnahme vorhören");
            vtQueue = Kit.Btn("Als Nächstes einreihen", QueueVoicetrack, "Voicetrack direkt ins laufende Programm (als nächsten Beitrag)");
            vtDiscard = Kit.Btn("Verwerfen", () => { recorder.Discard(); UpdateRecorder(); return Task.CompletedTask; });
            vtMeter.Foreground = Kit.Good;
            vtMeter.Background = Theme.Solid(Theme.C("#0DFFFFFF"));
            Add("voicetrack", "Voicetrack", Kit.V(
                Kit.Wrap(Kit.Text("Mikrofon"), micDevice),
                Kit.Wrap(Kit.Text("Titel"), vtTitle),
                vtMeter, vtState,
                Kit.Wrap(vtRecord, vtPlay),
                Kit.Wrap(vtQueue, vtDiscard)), "Aufnehmen, anhören und direkt ins laufende Programm einreihen", true);
            UpdateRecorder();
        }

        void FillMics()
        {
            var list = new List<AudioDevice> { new AudioDevice { Id = "", Name = "Windows-Standard" } };
            list.AddRange(AudioDevices.Wasapi(true));
            micDevice.ItemsSource = list;
            micDevice.SelectedIndex = 0;
        }

        Task ToggleRecord()
        {
            try
            {
                if (recorder.Recording) { recorder.Stop(); meterTimer.Stop(); C.Ok("Aufnahme fertig (" + recorder.Length.ToString(@"m\:ss") + ") – anhören oder einreihen"); }
                else
                {
                    if (vtTitle.Text.Trim().Length == 0) vtTitle.Text = "Voicetrack " + DateTime.Now.ToString("HH:mm");
                    recorder.Start((micDevice.SelectedItem as AudioDevice)?.Id);
                    meterTimer.Start();
                }
            }
            catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException || ex is InvalidOperationException || ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException)
            {
                recorder.Discard();
                meterTimer.Stop();
                C.Status("Mikrofon lässt sich nicht öffnen: " + ex.Message + " (Windows-Einstellungen → Datenschutz → Mikrofon)", true);
            }
            UpdateRecorder();
            return Task.CompletedTask;
        }

        void UpdateRecorder()
        {
            var has = recorder.File != null && !recorder.Recording;
            vtMeter.Value = recorder.Recording ? recorder.Peak : 0;
            vtMeter.Foreground = vtMeter.Value > 0.92 ? Kit.Bad : Kit.Good;
            vtState.Text = recorder.Recording ? "● Aufnahme läuft · " + recorder.Elapsed.ToString(@"m\:ss")
                : has ? "Aufnahme " + recorder.Length.ToString(@"m\:ss") + (recorder.Playing ? " · wird abgespielt" : "") + (mode == "lautfm" ? " · läuft bei laut.fm nach dem aktuellen Song" : " · kommt als Nächstes in die Warteschlange")
                : "Bereit – Mikrofon wählen und aufnehmen";
            vtState.Foreground = recorder.Recording ? Kit.Bad : Kit.Muted;
            if (vtRecord != null) vtRecord.Content = recorder.Recording ? "■ Stopp" : "● Aufnehmen";
            if (vtPlay != null) { vtPlay.IsEnabled = has; vtPlay.Content = recorder.Playing ? "■ Anhalten" : "▶ Anhören"; }
            if (vtQueue != null) { vtQueue.IsEnabled = has; vtQueue.Content = mode == "lautfm" ? "An laut.fm senden" : "Als Nächstes einreihen"; }
            if (vtDiscard != null) vtDiscard.IsEnabled = has || recorder.Recording;
            micDevice.IsEnabled = !recorder.Recording;
        }

        async Task QueueVoicetrack()
        {
            if (recorder.File == null || recorder.Recording) return;
            if (recorder.Playing) recorder.TogglePlay();
            var title = vtTitle.Text.Trim().Length > 0 ? vtTitle.Text.Trim() : "Voicetrack " + DateTime.Now.ToString("HH:mm");
            var file = recorder.File;
            var ok = await C.Run(async () =>
            {
                C.Status("Voicetrack wird hochgeladen …", false);
                // laut.fm-Encoder mit Live-Passwort vorhanden: als laut.fm-Ansage – läuft direkt nach dem aktuellen Song
                var lautEnc = (encoders.ItemsSource as IEnumerable<Row> ?? new Row[0]).FirstOrDefault(r => J.Str(r.El, "lautfm.status").Length > 0 && J.Bool(r.El, "hasPassword"));
                if (mode == "lautfm" && lautEnc != null)
                {
                    var r = await C.Api.UploadFile(C.St("/outputs/" + Uri.EscapeDataString(J.Str(lautEnc.El, "id")) + "/lautfm-announcement?name=" + Uri.EscapeDataString(title + ".wav")), file, "application/octet-stream", true);
                    C.Ok("„" + title + "“: " + J.Str(r, "message", "läuft bei laut.fm nach dem aktuellen Song"));
                }
                else if (mode == "lautfm")
                {
                    await C.Api.UploadFile(C.St("/programmchef/voicetrack?ext=wav&title=" + Uri.EscapeDataString(title)), file, "audio/wav", true);
                    C.Ok("„" + title + "“ wird für laut.fm umgewandelt und an die laufende Playlist gehängt (Stand: laut.fm → KI-Programmchef)");
                }
                else
                {
                    var m = await C.Api.UploadFile(C.St("/media?name=" + Uri.EscapeDataString(title + ".wav") + "&category=voice_track&folder=Voicetracks"), file, "audio/wav");
                    await C.Api.PostJ(C.St("/queue"), new { mediaId = J.Str(m, "id"), index = 0 });
                    await LoadQueue();
                    C.Ok("„" + title + "“ kommt als Nächstes");
                }
            }, "Voicetrack");
            if (!ok) return;
            recorder.Discard();
            vtTitle.Text = "";
            UpdateRecorder();
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
            await EnqueueIds(new List<string> { id }, queue.Items.Count);
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
            // der Server erwartet „index“ (früher wurde „to“ geschickt – dann bewegte sich nichts)
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + Uri.EscapeDataString(J.Str(r.El, "uid")) + "/move"), new { index }); await LoadQueue(); queue.SelectedIndex = index; }, "Warteschlange");
        }

        Task QueueAction(string action) => C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + action)); await LoadQueue(); }, "Warteschlange");

        async Task ClearQueue()
        {
            if (queue.Items.Count == 0 || !Dlg.Confirm(C.Owner, "Die ganze Warteschlange leeren?")) return;
            await QueueAction("clear");
        }
    }

    /// <summary>Ein Deck als Karte wie .deck im Web-Studio (Farbe je Deck, farbige Kopfzeile, Titelkachel, Restzeit, runde Knöpfe).
    /// Aktualisiert sich selbst aus dem DeckViewModel. Titel aus Archiv oder Warteschlange können daraufgezogen werden.</summary>
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
        readonly Brush normalBorder;
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
            BorderBrush = normalBorder = Theme.Solid(Theme.Alpha(color, 0.55));
            Background = Theme.Linear(165, (Theme.Mix(color, 0.22, Theme.C("#0D1424")), 0), (Theme.C("#0A1120"), 0.65));
            SnapsToDevicePixels = true;
            remain.Foreground = c;
            bar.Foreground = c;
            bar.Background = Theme.Solid(Theme.C("#0DFFFFFF"));
            tempo.Foreground = c;

            // Titel aus Archiv oder Warteschlange auf das Deck ziehen = laden
            AllowDrop = true;
            DragOver += (s, e) =>
            {
                if (!e.Data.GetDataPresent(StudioPage.MediaFormat) && !e.Data.GetDataPresent(StudioPage.QueueFormat)) return;
                e.Effects = DragDropEffects.Copy;
                BorderBrush = c;
                BorderThickness = new Thickness(3);
                e.Handled = true;
            };
            DragLeave += (s, e) => { BorderBrush = normalBorder; BorderThickness = new Thickness(1); };
            Drop += async (s, e) =>
            {
                BorderBrush = normalBorder;
                BorderThickness = new Thickness(1);
                if (!e.Data.GetDataPresent(StudioPage.MediaFormat) && !e.Data.GetDataPresent(StudioPage.QueueFormat)) return;
                e.Handled = true;
                await page.DropOnDeck(vm, e.Data);
            };

            // .deck-head: farbiger Streifen mit Name und Zustand
            var head = new DockPanel { LastChildFill = true };
            DockPanel.SetDock(status, Dock.Right);
            head.Children.Add(status);
            var name = Kit.H(Kit.Icon("", 13, Brushes.White), new TextBlock { Text = "Deck " + vm.Id, FontWeight = FontWeights.Bold, Foreground = Brushes.White, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
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
            buttons.Children.Add(DeckBtn("", () => page.DeckAction(vm, "play"), "Abspielen", true));
            buttons.Children.Add(DeckBtn("", () => page.DeckAction(vm, "pause"), "Pause", true));
            buttons.Children.Add(DeckBtn("", () => page.DeckAction(vm, "stop"), "Stopp (bereit)", true));
            buttons.Children.Add(DeckBtn("+10", () => page.Skip(vm, 10000), "10 Sekunden vor", false));
            buttons.Children.Add(DeckBtn("", () => page.DeckAction(vm, "eject"), "Deck leeren", true));

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

            var load = Kit.Btn("Titel laden … (oder hierher ziehen)", () => page.LoadIntoDeck(vm));
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
