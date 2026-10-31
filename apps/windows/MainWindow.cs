// AnMaCha Cast für Windows - Hauptfenster im Aufbau und in der Optik des Web-Studios: Seitenleiste mit Wortmarke, LIVE-Knopf und
// Abschnitten links, Kopfzeile mit Senderwahl, Verbindung und Uhr oben, Statusleiste unten. Die Oberfläche wird im Code aufgebaut
// (kein XAML-Compiler; die Stile der Bedienelemente lädt Ui/Theme.cs aus Ui/Theme.xaml). Verbindet sich mit der eingebauten Engine dieses PCs oder mit entfernten AnMaCha-Cast-Servern
// (Kopplungscode oder Anmeldung) und bietet Studio, Mediathek, Playlists, Planung, Podcast, Statistik, Hörer, KI, laut.fm,
// Server & Geräte und System nativ an; nur seltene Einstellungen bleiben im eingebetteten Web-Studio (BrowserForm).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Pages;
using AnMaChaCast.Ui;

namespace AnMaChaCast
{
    public sealed class MainWindow : Window
    {
        static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast");
        static readonly string BoundsFile = Path.Combine(LocalDir, "fenster.txt");

        readonly EventWaitHandle showSignal;
        readonly EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "AnMaChaCast.Studio.Quit");
        readonly System.Windows.Forms.NotifyIcon tray = new System.Windows.Forms.NotifyIcon();
        readonly DispatcherTimer watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        readonly DispatcherTimer clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };

        readonly Ctx ctx = new Ctx();
        readonly ServerStore servers;
        readonly List<View> pages = new List<View>();
        readonly List<ToggleButton> nav = new List<ToggleButton>();
        readonly ComboBox serverPicker = new ComboBox { Margin = new Thickness(4, 0, 4, 0), DisplayMemberPath = "Name" };
        readonly ComboBox stationPicker = new ComboBox { MinWidth = 180, MaxWidth = 260, DisplayMemberPath = "name" };
        readonly TextBlock stationLetter = new TextBlock { Text = "FM", FontWeight = FontWeights.Black, FontSize = 14, Foreground = System.Windows.Media.Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock stationSlogan = Kit.Text("", 11, false, Kit.Muted);
        readonly System.Windows.Shapes.Ellipse liveDot = new System.Windows.Shapes.Ellipse { Width = 10, Height = 10, Fill = Kit.Bad, Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock clockText = new TextBlock { Text = "--:--:--", FontSize = 24, FontWeight = FontWeights.Bold, Foreground = Kit.Fg, HorizontalAlignment = HorizontalAlignment.Right };
        readonly TextBlock dateText = new TextBlock { FontSize = 11, Foreground = Kit.Muted, HorizontalAlignment = HorizontalAlignment.Right };
        readonly TextBlock statusText = Kit.Text("", 12, false, Kit.Muted);
        readonly string snapshotDir;
        OnAirBar onAir;
        readonly Grid host = new Grid();

        EngineInfo engine;
        ApiClient api;
        BrowserForm browser;
        CancellationTokenSource sseCts;
        int current;
        int generation;
        bool suppress;
        bool quitting;
        bool hintShown;
        int downChecks;
        bool setupOffered;

        public MainWindow(EventWaitHandle show, bool minimized, string snapshot = null)
        {
            showSignal = show;
            snapshotDir = snapshot;
            Title = "AnMaCha Cast";
            Background = Kit.Bg;
            Foreground = Kit.Fg;
            FontFamily = new System.Windows.Media.FontFamily("Segoe UI");
            FontSize = 13;
            MinWidth = 1000;
            MinHeight = 640;
            Theme.DarkTitle(this);
            System.Windows.Media.TextOptions.SetTextFormattingMode(this, System.Windows.Media.TextFormattingMode.Display);
            servers = new ServerStore(Path.Combine(LocalDir, "servers.json"), new DpapiProtector());
            ctx.Servers = servers;
            ctx.Owner = this;
            ctx.Status = SetStatus;
            ctx.SwitchTo = SwitchTo;
            ctx.Reconnect = () => SwitchTo(servers.Active);
            ctx.EngineLog = () => engine?.Log;
            if (snapshotDir == null) LoadBounds(); else { Width = 1600; Height = 1000; WindowStartupLocation = WindowStartupLocation.CenterScreen; }

            BuildLayout();
            BuildTray();

            watch.Tick += (s, e) => Watch();
            clock.Tick += (s, e) => UpdateClock();
            UpdateClock();
            clock.Start();
            Closing += OnClosing;

            // Nicht an Loaded hängen: bei --minimized (Autostart) wird das Fenster nie gezeigt, die Verbindung muss trotzdem stehen.
            var first = SwitchTo(servers.Active);
            if (snapshotDir != null) Loaded += async (s, e) => { await first; await Snapshot(); };

            // Zweiter Programmstart: vorhandenes Fenster nach vorn holen
            new Thread(() =>
            {
                while (true)
                {
                    showSignal.WaitOne();
                    try { Dispatcher.Invoke(ShowStudio); } catch { return; }
                }
            }) { IsBackground = true, Name = "AnMaChaCast.Show" }.Start();
            // AnMaChaCast.exe --quit (Update): nur das Fenster schließen, die Engine läuft weiter
            new Thread(() =>
            {
                quitSignal.WaitOne();
                try { Dispatcher.Invoke(CloseWindowOnly); } catch { }
            }) { IsBackground = true, Name = "AnMaChaCast.Quit" }.Start();
        }

        // ---------- Aufbau ----------

        // Seiten in der Navigation: Abschnitt, Symbol (Segoe Fluent Icons / MDL2) – gleiche Gruppen wie die Seitenleiste des Web-Studios
        static readonly (string Section, string Icon)[] NavInfo =
        {
            ("Überblick", "\uE9E9"),               // Studio
            ("Musik & Inhalte", "\uE8D6"),         // Mediathek
            ("Programm planen", "\uE8FD"),         // Playlists
            ("Programm planen", "\uE787"),         // Planung & Aufnahme
            ("Sender & Ausspielung", "\uE701"),    // Ausgänge & Quellen
            ("System", "\uE713"),                  // Einstellungen
            ("Musik & Inhalte", "\uE720"),         // Podcast
            ("Analyse", "\uE9D2"),                 // Statistik
            ("Analyse", "\uE716"),                 // Hörer
            ("KI & Automatik", "\uE945"),          // KI
            ("Sender & Ausspielung", "\uE7F6"),    // laut.fm
            ("System", "\uE968"),                  // Server & Geräte
            ("System", "\uE770"),                  // System
        };
        static readonly string[] SectionOrder = { "Überblick", "Programm planen", "KI & Automatik", "Musik & Inhalte", "Sender & Ausspielung", "Analyse", "System" };

        void BuildLayout()
        {
            pages.AddRange(new View[]
            {
                new StudioPage(ctx), new LibraryPage(ctx), new PlaylistsPage(ctx), new PlanningPage(ctx), new OutputsPage(ctx), new SettingsPage(ctx), new PodcastPage(ctx), new StatsPage(ctx),
                new ListenersPage(ctx), new AiPage(ctx), new LautFmPage(ctx), new ServersPage(ctx), new SystemPage(ctx),
            });

            // Hintergrund wie body im Web-Studio: zwei weiche Lichtflecken (blau oben links, violett oben rechts) auf #050A14
            var root = new Grid { Background = Kit.Bg };
            root.Children.Add(new Border { Background = Glow(0.2, -0.1, 0.75, 0.6, "#2938BDF8"), IsHitTestVisible = false });
            root.Children.Add(new Border { Background = Glow(1.1, 0.1, 0.56, 0.5, "#21818CF8"), IsHitTestVisible = false });
            var app = new Grid();
            app.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(206) });
            app.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            root.Children.Add(app);

            app.Children.Add(BuildSidebar());

            var main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetColumn(main, 1);
            app.Children.Add(main);

            main.Children.Add(BuildTopBar());

            foreach (var p in pages) { p.Visibility = Visibility.Collapsed; host.Children.Add(p); }
            host.Margin = new Thickness(10);
            Grid.SetRow(host, 1);
            main.Children.Add(host);

            // .status: Statuszeile unten
            var bar = new Border
            {
                Background = Theme.Solid(Theme.C("#E6050B17")), BorderBrush = Kit.Line, BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(14, 6, 14, 6),
                Child = statusText,
            };
            Grid.SetRow(bar, 2);
            main.Children.Add(bar);
            Content = root;

            serverPicker.ItemsSource = servers.All;
            serverPicker.SelectionChanged += (s, e) =>
            {
                if (suppress || !(serverPicker.SelectedItem is ServerProfile p) || p.Id == servers.ActiveId) return;
                _ = SwitchTo(p);
            };
            stationPicker.SelectionChanged += (s, e) =>
            {
                if (suppress || !(stationPicker.SelectedItem is StationInfo st) || st.id == ctx.StationId) return;
                ctx.StationId = st.id;
                servers.Active.LastStation = st.id;
                servers.Save();
                ShowStation(st);
                StartEvents();
                _ = onAir.Refresh();
                _ = pages[current].Show();
            };
            Conn("GETRENNT", Kit.Muted);
            ShowPageVisual(0);
        }

        static System.Windows.Media.RadialGradientBrush Glow(double x, double y, double rx, double ry, string color)
        {
            var c = Theme.C(color);
            var g = new System.Windows.Media.RadialGradientBrush { Center = new Point(x, y), GradientOrigin = new Point(x, y), RadiusX = rx, RadiusY = ry };
            g.GradientStops.Add(new System.Windows.Media.GradientStop(c, 0));
            g.GradientStops.Add(new System.Windows.Media.GradientStop(Theme.Alpha(c, 0), 1));
            g.Freeze();
            return g;
        }

        /// <summary>.sidebar: Wortmarke, roter LIVE-Knopf, Abschnitte mit Seiten, unten die Serverwahl.</summary>
        UIElement BuildSidebar()
        {
            var side = new Grid();
            side.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            side.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            side.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            side.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var frame = new Border
            {
                Background = Theme.Linear(180, (Theme.C("#F50A1428"), 0), (Theme.C("#F5060C1A"), 1)), BorderBrush = Kit.Line, BorderThickness = new Thickness(0, 0, 1, 0),
                Padding = new Thickness(10, 14, 10, 12), Child = side,
            };

            var mark = Theme.Wordmark(368);
            UIElement logo = mark != null
                ? (UIElement)new System.Windows.Controls.Image { Source = mark, MaxWidth = 184, Stretch = System.Windows.Media.Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Left }
                : Kit.Text("AnMaCha Cast", 16, true, System.Windows.Media.Brushes.White);
            side.Children.Add(new Border { Padding = new Thickness(4, 4, 8, 12), BorderBrush = Kit.Line, BorderThickness = new Thickness(0, 0, 0, 1), Margin = new Thickness(0, 0, 0, 12), Child = logo });

            var live = new Button { Margin = new Thickness(0, 0, 0, 8), HorizontalContentAlignment = HorizontalAlignment.Center, ToolTip = "Studio mit Decks, Cardwall und Warteschlange" };
            Theme.Use(live, "Btn.Live");
            live.Content = Kit.H(Kit.Icon("\uE701", 15), new TextBlock { Text = "LIVE", FontWeight = FontWeights.Bold, Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            live.Click += (s, e) => ShowPage(0);
            Grid.SetRow(live, 1);
            side.Children.Add(live);

            var navPanel = new StackPanel();
            nav.Clear();
            for (var i = 0; i < pages.Count; i++) nav.Add(null);
            foreach (var section in SectionOrder)
            {
                var items = new StackPanel();
                var arrow = new TextBlock { Text = "\u203A", FontSize = 15, Foreground = Kit.Accent, HorizontalAlignment = HorizontalAlignment.Right, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new System.Windows.Media.RotateTransform(90), Margin = new Thickness(0, -4, 0, -4) };
                var headGrid = new Grid();
                headGrid.Children.Add(new TextBlock { Text = section.ToUpperInvariant(), VerticalAlignment = VerticalAlignment.Center });
                headGrid.Children.Add(arrow);
                var head = new Button { Content = headGrid };
                Theme.Use(head, "NavSection");
                head.Click += (s, e) =>
                {
                    var open = items.Visibility != Visibility.Visible;
                    items.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
                    ((System.Windows.Media.RotateTransform)arrow.RenderTransform).Angle = open ? 90 : 0;
                };
                navPanel.Children.Add(head);
                for (var i = 0; i < pages.Count; i++)
                {
                    if (NavInfo[i].Section != section) continue;
                    var index = i;
                    var row = new DockPanel();
                    var icon = Kit.Icon(NavInfo[i].Icon, 15);
                    icon.Margin = new Thickness(0, 0, 10, 0);
                    DockPanel.SetDock(icon, Dock.Left);
                    row.Children.Add(icon);
                    row.Children.Add(new TextBlock { Text = pages[i].Title, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center });
                    var b = new ToggleButton { Content = row, ToolTip = pages[i].Title };
                    if (Theme.Loaded) Theme.Use(b, "Nav");
                    else { b.HorizontalContentAlignment = HorizontalAlignment.Stretch; b.Padding = new Thickness(10, 8, 10, 8); b.Background = Kit.PanelBg; b.Foreground = Kit.Fg; b.BorderBrush = Kit.Line; }
                    b.Click += (s, e) => ShowPage(index);
                    nav[i] = b;
                    items.Children.Add(b);
                }
                navPanel.Children.Add(items);
            }
            var scroll = Kit.Scroll(navPanel);
            scroll.Padding = new Thickness(0);
            Grid.SetRow(scroll, 2);
            side.Children.Add(scroll);

            // .side-foot: Server dieses PCs oder entfernter Server
            var foot = Kit.V(new TextBlock { Text = "SERVER", FontSize = 10, Foreground = Kit.Muted, Margin = new Thickness(8, 10, 0, 6) }, serverPicker);
            Grid.SetRow(foot, 3);
            side.Children.Add(foot);
            return frame;
        }

        /// <summary>.top wie im Web-Studio: oben Senderwahl, ON-AIR-Anzeige und „Jetzt läuft“, darunter die Betriebsart;
        /// rechts MIC LIVE, Sendung, Web-Studio-Knopf und die Uhr mit Verbindungspunkt.</summary>
        UIElement BuildTopBar()
        {
            onAir = new OnAirBar(ctx);
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MaxWidth = 560 });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var frame = new Border
            {
                Background = Theme.Solid(Theme.C("#B3060D1C")), BorderBrush = Kit.Line, BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(14, 9, 14, 9),
                Child = grid,
            };

            // .station-pick
            var logo = new Border
            {
                Width = 42, Height = 42, CornerRadius = new CornerRadius(9), Margin = new Thickness(0, 0, 10, 0),
                Background = Theme.Linear(135, (Theme.C("#38BDF8"), 0), (Theme.C("#818CF8"), 1)), Child = stationLetter,
            };
            if (Theme.Loaded) Theme.Use(stationPicker, "Combo.Station");
            var stationText = Kit.V(stationPicker, stationSlogan);
            stationText.VerticalAlignment = VerticalAlignment.Center;
            stationSlogan.MaxWidth = 240;
            var pick = new Border
            {
                CornerRadius = new CornerRadius(9), BorderThickness = new Thickness(1), BorderBrush = Theme.Solid(Theme.C("#4738BDF8")), Padding = new Thickness(10, 6, 10, 6), MinWidth = 260,
                Background = Theme.Linear(135, (Theme.C("#C7082442"), 0), (Theme.C("#C713143B"), 1)), Child = Kit.H(logo, stationText),
            };
            grid.Children.Add(pick);

            onAir.OnAir.Margin = new Thickness(12, 0, 0, 0);
            Grid.SetColumn(onAir.OnAir, 1);
            grid.Children.Add(onAir.OnAir);
            onAir.Now.Margin = new Thickness(12, 0, 0, 0);
            Grid.SetColumn(onAir.Now, 2);
            grid.Children.Add(onAir.Now);

            // zweite Zeile links: Betriebsart
            onAir.Modes.Margin = new Thickness(0, 8, 0, 0);
            Grid.SetRow(onAir.Modes, 1);
            Grid.SetColumnSpan(onAir.Modes, 2);
            grid.Children.Add(onAir.Modes);

            // zweite Zeile rechts: MIC LIVE, Sendung, Web-Studio
            var web = Kit.Btn("Weitere Funktionen", OpenBrowser, "Seltene Einstellungen im eingebetteten Web-Studio (Voice Studio, MusicHub, Einrichtungsassistent …)");
            web.Content = Kit.H(Kit.Icon("\uE774", 14), new TextBlock { Text = "Weitere Funktionen", Margin = new Thickness(7, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            var actions = Kit.H(web, onAir.Mic, onAir.Stream);
            actions.HorizontalAlignment = HorizontalAlignment.Right;
            actions.Margin = new Thickness(0, 5, 0, 0);
            Grid.SetRow(actions, 1);
            Grid.SetColumn(actions, 2);
            Grid.SetColumnSpan(actions, 2);
            grid.Children.Add(actions);

            // rechts über beide Zeilen: Uhr mit Datum, Verbindungspunkt
            var clockBox = new Border
            {
                BorderBrush = Theme.Solid(Theme.C("#3338BDF8")), BorderThickness = new Thickness(1, 0, 0, 0), Padding = new Thickness(12, 0, 4, 0), MinWidth = 118, Margin = new Thickness(12, 0, 0, 0),
                Child = Kit.H(Kit.V(clockText, dateText), liveDot), VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(clockBox, 4);
            Grid.SetRowSpan(clockBox, 2);
            grid.Children.Add(clockBox);
            onAir.Start();
            return frame;
        }

        void UpdateClock()
        {
            var now = DateTime.Now;
            clockText.Text = now.ToString("HH:mm:ss");
            dateText.Text = now.ToString("ddd, dd. MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("de-DE"));
        }

        /// <summary>Verbindungsanzeige oben und Punkt neben der Uhr (wie .conn im Web-Studio).</summary>
        void Conn(string text, System.Windows.Media.Brush color)
        {
            liveDot.ToolTip = "Serververbindung: " + text;
            if (color == Kit.Warn) SetStatus("Verbindung: " + text, false);
            var ok = color == Kit.Good;
            if (!ok && onAir != null && ctx.Api == null) onAir.Clear();
            liveDot.Fill = ok ? Kit.Good : Kit.Bad;
            liveDot.Effect = ok ? GreenGlow : null;
        }

        static readonly System.Windows.Media.Effects.DropShadowEffect GreenGlow = MakeGlow();

        static System.Windows.Media.Effects.DropShadowEffect MakeGlow()
        {
            var e = new System.Windows.Media.Effects.DropShadowEffect { Color = Theme.C("#22C55E"), BlurRadius = 8, ShadowDepth = 0, Opacity = 0.9 };
            e.Freeze();
            return e;
        }

        void ShowStation(StationInfo st)
        {
            var name = st?.name ?? "";
            stationLetter.Text = name.Length > 0 ? char.ToUpperInvariant(name.Trim()[0]).ToString() : "FM";
            stationSlogan.Text = st?.slogan ?? "";
            stationSlogan.Visibility = string.IsNullOrEmpty(stationSlogan.Text) ? Visibility.Collapsed : Visibility.Visible;
        }

        static UIElement Spacer(double w) => new Border { Width = w };

        void BuildTray()
        {
            tray.Icon = System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);
            tray.Text = "AnMaCha Cast";
            var menu = new System.Windows.Forms.ContextMenuStrip();
            menu.Items.Add("Studio öffnen", null, (s, e) => ShowStudio());
            menu.Items.Add("Protokoll anzeigen", null, (s, e) => OpenLog());
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            menu.Items.Add("AnMaCha Cast beenden", null, (s, e) => Quit(true));
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowStudio();
            tray.Visible = true;
        }

        void SetStatus(string text, bool bad)
        {
            if (Dispatcher.CheckAccess()) { statusText.Text = text; statusText.Foreground = bad ? Kit.Bad : Kit.Muted; }
            else Dispatcher.BeginInvoke(new Action(() => SetStatus(text, bad)));
        }

        // ---------- Navigation ----------

        void ShowPageVisual(int index)
        {
            current = index;
            for (var i = 0; i < pages.Count; i++)
            {
                pages[i].Visibility = i == index ? Visibility.Visible : Visibility.Collapsed;
                nav[i].IsChecked = i == index;
            }
        }

        void ShowPage(int index)
        {
            ShowPageVisual(index);
            _ = pages[index].Show();
        }

        // ---------- Verbindung ----------

        /// <summary>Zu einem Server wechseln (Motor dieses PCs oder entfernter Server) und alle Seiten neu laden.</summary>
        async Task SwitchTo(ServerProfile p)
        {
            var gen = ++generation;
            sseCts?.Cancel();
            SetStatus("Verbinde mit „" + p.Name + "“ …", false);
            Conn("verbinde …", Kit.Warn);
            try
            {
                Uri origin;
                string token;
                if (p.IsLocal)
                {
                    if (!await EnsureEngine()) return;
                    var raw = new Uri(engine.Url);
                    origin = new Uri(raw.GetLeftPart(UriPartial.Authority));
                    token = ParseToken(raw.Fragment);
                }
                else
                {
                    if (string.IsNullOrEmpty(p.Token)) throw new ApiException(401, "Für diesen Server fehlt die Kopplung – unter „Server & Geräte“ erneut hinzufügen");
                    origin = new Uri(p.BaseUrl);
                    token = p.Token;
                }
                var client = new ApiClient(origin, token);
                await client.GetJ("/me", 15); // prüft Erreichbarkeit und Anmeldung
                var stations = await client.Stations();
                if (gen != generation) { client.Dispose(); return; }

                api?.Dispose();
                api = client;
                ctx.Api = client;
                ctx.Server = p;
                ctx.Stations = stations;
                servers.ActiveId = p.Id;
                var pick = stations.FirstOrDefault(s => s.id == p.LastStation) ?? stations.FirstOrDefault();
                ctx.StationId = pick?.id ?? "";
                servers.Save();
                suppress = true;
                serverPicker.ItemsSource = servers.All;
                serverPicker.SelectedItem = servers.All.FirstOrDefault(x => x.Id == p.Id);
                stationPicker.ItemsSource = stations;
                stationPicker.SelectedItem = pick;
                suppress = false;
                tray.Text = p.IsLocal ? "AnMaCha Cast läuft" : "AnMaCha Cast · " + p.Name;
                Conn("verbunden", Kit.Good);
                ShowStation(pick);
                SetStatus("Verbunden mit „" + p.Name + "“", false);
                downChecks = 0;
                if (!string.IsNullOrEmpty(ctx.StationId)) StartEvents();
                watch.Start();
                _ = onAir.Refresh();
                await pages[current].Show();
                if (p.IsLocal && snapshotDir == null) _ = OfferSetup(client);
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                if (gen != generation) return;
                api?.Dispose();
                api = null;
                ctx.Api = null;
                ctx.Server = p;
                servers.ActiveId = p.Id;
                servers.Save();
                suppress = true;
                serverPicker.ItemsSource = servers.All;
                serverPicker.SelectedItem = servers.All.FirstOrDefault(x => x.Id == p.Id);
                suppress = false;
                Conn("getrennt", Kit.Bad);
                SetStatus("Verbindung zu „" + p.Name + "“ fehlgeschlagen: " + ex.Message, true);
                watch.Start();
                if (!p.IsLocal) ShowPage(pages.FindIndex(x => x is ServersPage));
            }
        }

        /// <summary>Erster Start dieser Installation: den Einrichtungsassistenten anbieten (er läuft im Web-Studio-Fenster).</summary>
        async Task OfferSetup(ApiClient client)
        {
            if (setupOffered) return;
            try
            {
                var s = await client.GetJ("/setup", 10);
                if (!J.Bool(s, "required")) return;
                setupOffered = true;
                if (!IsVisible) return; // Autostart im Hintergrund: nicht stören, beim nächsten sichtbaren Start erneut fragen
                if (Dlg.Confirm(this, "AnMaCha Cast ist noch nicht eingerichtet.\n\nDer Einrichtungsassistent führt durch Sender, Musikordner, Stream-Ausgang und KI. Jetzt öffnen?", "Willkommen bei AnMaCha Cast")) OpenBrowser();
            }
            catch (ApiException) { }
        }

        async Task<bool> EnsureEngine()
        {
            SetStatus("Engine startet …", false);
            engine = await Task.Run(() =>
            {
                var info = Engine.Query();
                if (info.Running && Engine.Alive(info.Health)) return info;
                Engine.Start();
                Engine.WaitAlive(info.Health, 90000);
                return Engine.Query();
            });
            if (string.IsNullOrEmpty(engine.Url) || !Engine.Alive(engine.Health))
            {
                if (snapshotDir != null) { SetStatus("Engine startet nicht", true); return false; }
                var r = System.Windows.MessageBox.Show(this, "Die AnMaCha-Cast-Engine startet nicht.\n\nProtokoll öffnen?", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Error);
                if (r == MessageBoxResult.Yes) OpenLog();
                Quit(false);
                return false;
            }
            return true;
        }

        /// <summary>Token aus dem Fragment "#token=…" der von der Engine gedruckten URL (siehe src/server/main.ts).</summary>
        static string ParseToken(string fragment)
        {
            var frag = (fragment ?? "").TrimStart('#');
            foreach (var part in frag.Split('&'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv.Length == 2 && kv[0] == "token") return Uri.UnescapeDataString(kv[1]);
            }
            return "";
        }

        // ---------- Live-Ereignisse (SSE) ----------

        void StartEvents()
        {
            sseCts?.Cancel();
            sseCts = new CancellationTokenSource();
            var ct = sseCts.Token;
            var sid = ctx.StationId;
            var client = api;
            if (client == null || string.IsNullOrEmpty(sid)) return;
            Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try { await client.Subscribe(sid, (type, data) => Dispatcher.BeginInvoke(new Action(() => { onAir?.OnEvent(type); foreach (var pg in pages) pg.OnEvent(type); })), ct); }
                    catch { /* Verbindung verloren - kurze Pause, dann neu verbinden */ }
                    if (ct.IsCancellationRequested) break;
                    try { await Task.Delay(2000, ct); } catch (TaskCanceledException) { }
                }
            }, ct);
        }

        // ---------- Überwachung ----------

        async void Watch()
        {
            if (quitting) return;
            var p = servers.Active;
            if (p.IsLocal)
            {
                if (engine == null) return;
                var alive = await Task.Run(() => Engine.Alive(engine.Health));
                if (alive) { downChecks = 0; Conn("verbunden", Kit.Good); return; }
                if (++downChecks < 8) { Conn("Engine antwortet nicht …", Kit.Warn); return; }
                watch.Stop();
                if (snapshotDir != null) return;
                ShowStudio();
                var r = System.Windows.MessageBox.Show(this, "Die AnMaCha-Cast-Engine läuft nicht mehr.\n\nJetzt neu starten?", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (r != MessageBoxResult.Yes) { Quit(false); return; }
                downChecks = 0;
                await Task.Run(() => { Engine.Start(); Engine.WaitAlive(engine.Health, 90000); });
                engine = await Task.Run(() => Engine.Query());
                await SwitchTo(p);
                return;
            }
            try
            {
                await ApiClient.Health(new Uri(p.BaseUrl));
                downChecks = 0;
                if (ctx.Api != null) Conn("verbunden", Kit.Good);
            }
            catch
            {
                Conn("Server nicht erreichbar", Kit.Bad);
            }
        }

        // ---------- Studio im Fenster (WebView2) ----------

        void OpenBrowser()
        {
            if (ctx.Api == null) { SetStatus("Erst mit einem Server verbinden", true); return; }
            var url = ctx.Api.Origin.GetLeftPart(UriPartial.Authority) + "/#token=" + Uri.EscapeDataString(ctx.Api.Token);
            if (browser == null || browser.IsDisposed) { browser = new BrowserForm(url); browser.Show(); }
            else browser.Activate();
        }

        // ---------- Bildschirmfotos (AnMaChaCast.exe --snapshot <Ordner>, für die Build-Prüfung) ----------

        /// <summary>Jede Seite einmal öffnen und das Fenster als PNG speichern, dann beenden (Engine läuft weiter, --stop beendet sie).
        /// Exit-Code 2, wenn das Design (Theme.xaml) nicht geladen werden konnte – so fällt ein kaputtes Design im Build auf.</summary>
        async Task Snapshot()
        {
            var code = 0;
            try
            {
                Directory.CreateDirectory(snapshotDir);
                if (!Theme.Loaded)
                {
                    File.WriteAllText(Path.Combine(snapshotDir, "theme-error.txt"), Theme.Error ?? "unbekannt");
                    code = 2;
                }
                for (var i = 0; i < pages.Count; i++)
                {
                    ShowPage(i);
                    await Task.Delay(i == 0 ? 2500 : 1200);
                    UpdateLayout();
                    var root = (FrameworkElement)Content;
                    var w = (int)Math.Ceiling(root.ActualWidth);
                    var h = (int)Math.Ceiling(root.ActualHeight);
                    var bmp = new System.Windows.Media.Imaging.RenderTargetBitmap(w, h, 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
                    bmp.Render(root);
                    var png = new System.Windows.Media.Imaging.PngBitmapEncoder();
                    png.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
                    var name = (i + 1).ToString("00") + "-" + new string(pages[i].Title.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray()) + ".png";
                    using (var f = File.Create(Path.Combine(snapshotDir, name))) png.Save(f);
                }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                try { File.WriteAllText(Path.Combine(snapshotDir, "snapshot-error.txt"), ex.ToString()); } catch { }
                code = 3;
            }
            quitting = true;
            watch.Stop();
            sseCts?.Cancel();
            tray.Visible = false;
            tray.Dispose();
            System.Windows.Application.Current.Shutdown(code);
        }

        // ---------- Fenster, Tray, Beenden ----------

        void ShowStudio()
        {
            if (!IsVisible) Show();
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();
        }

        void OpenLog()
        {
            var log = engine?.Log;
            if (string.IsNullOrEmpty(log) || !File.Exists(log)) log = Engine.Query().Log;
            if (!string.IsNullOrEmpty(log) && File.Exists(log))
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true });
        }

        void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (snapshotDir != null) return;
            SaveBounds();
            if (!quitting)
            {
                e.Cancel = true;
                Hide();
                if (!hintShown)
                {
                    hintShown = true;
                    tray.ShowBalloonTip(4000, "AnMaCha Cast läuft weiter", "Automation und Streams laufen im Hintergrund. Beenden über das Symbol im Infobereich.", System.Windows.Forms.ToolTipIcon.Info);
                }
            }
        }

        void Quit(bool ask)
        {
            if (quitting) return;
            if (ask && System.Windows.MessageBox.Show(this, "AnMaCha Cast komplett beenden? Automation und alle Streams dieses PCs stoppen.", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            quitting = true;
            watch.Stop();
            sseCts?.Cancel();
            SaveBounds();
            tray.Text = "AnMaCha Cast wird beendet …";
            Task.Run(() => Engine.Stop()).ContinueWith(_ => Dispatcher.Invoke(() =>
            {
                tray.Visible = false;
                tray.Dispose();
                System.Windows.Application.Current.Shutdown();
            }));
        }

        void CloseWindowOnly()
        {
            quitting = true;
            watch.Stop();
            sseCts?.Cancel();
            SaveBounds();
            tray.Visible = false;
            tray.Dispose();
            System.Windows.Application.Current.Shutdown();
        }

        void LoadBounds()
        {
            Width = 1320; Height = 860;
            try
            {
                var p = File.ReadAllText(BoundsFile).Split(',');
                Left = double.Parse(p[0]); Top = double.Parse(p[1]); Width = double.Parse(p[2]); Height = double.Parse(p[3]);
                if (p.Length > 4 && p[4] == "max") WindowState = WindowState.Maximized;
            }
            catch { WindowStartupLocation = WindowStartupLocation.CenterScreen; }
        }

        void SaveBounds()
        {
            try
            {
                var b = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
                Directory.CreateDirectory(LocalDir);
                File.WriteAllText(BoundsFile, $"{b.X},{b.Y},{b.Width},{b.Height},{(WindowState == WindowState.Maximized ? "max" : "normal")}");
            }
            catch { }
        }
    }
}
