// Bausteine der Oberfläche im Code (Farben, Knöpfe, Karten) in der Optik des Web-Studios (studio/styles.css). Die Stile der
// Bedienelemente selbst stehen in Ui/Theme.xaml; die Oberfläche wird ohne XAML-Compiler aufgebaut, damit sie auch ohne
// Windows-Rechner übersetzt und geprüft werden kann (apps/windows/check).
using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace AnMaChaCast.Ui
{
    static class Kit
    {
        static SolidColorBrush B(string hex) { var b = (SolidColorBrush)new BrushConverter().ConvertFromString(hex); b.Freeze(); return b; }

        // = CSS-Variablen aus studio/styles.css (:root)
        public static readonly Brush Bg = B("#050A14");
        public static readonly Brush Bg2 = B("#0A1120");
        public static readonly Brush PanelBg = B("#0D1424");
        public static readonly Brush Field = B("#121C30");
        public static readonly Brush Line = B("#2938BDF8");
        public static readonly Brush Line2 = B("#5238BDF8");
        public static readonly Brush PanelLine = B("#6138BDF8");
        public static readonly Brush Fg = B("#E6EDF8");
        public static readonly Brush Muted = B("#8A9BB8");
        public static readonly Brush Accent = B("#38BDF8");
        public static readonly Brush Violet = B("#818CF8");
        public static readonly Brush AccentDark = B("#0EA5E9");
        public static readonly Brush Good = B("#22C55E");
        public static readonly Brush Warn = B("#F59E0B");
        public static readonly Brush Bad = B("#EF4444");

        /// <summary>.panel: Verlauf 165° von rgba(13,20,36,.94) nach rgba(8,13,26,.96).</summary>
        public static readonly Brush PanelGradient = Theme.Linear(165, (Theme.C("#F00D1424"), 0), (Theme.C("#F5080D1A"), 1));

        public static TextBlock Text(string text, double size = 13, bool bold = false, Brush fg = null, bool wrap = false)
        {
            return new TextBlock
            {
                Text = text, FontSize = size, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, Foreground = fg ?? Fg,
                TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap, TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        public static TextBlock Hint(string text) => Text(text, 12, false, Muted, true);

        // Farben, Rahmen und Abstände kommen aus Theme.xaml (.btn / .btn.primary); nur ohne geladenes Design lokal gesetzt.
        static Button Make(string text, string tip, bool primary)
        {
            var b = new Button { Content = text, ToolTip = tip, Margin = new Thickness(3) };
            if (Theme.Loaded) { if (primary) Theme.Use(b, "Btn.Primary"); }
            else { b.Padding = new Thickness(12, 6, 12, 6); b.Background = primary ? AccentDark : Field; b.Foreground = primary ? Brushes.White : Fg; b.BorderBrush = primary ? Accent : Line; }
            return b;
        }

        public static Button Btn(string text, Action click, string tip = null, bool primary = false)
        {
            var b = Make(text, tip, primary);
            b.Click += (s, e) => click();
            return b;
        }

        /// <summary>Knopf mit asynchroner Aktion: während sie läuft, ist er gesperrt (kein doppeltes Auslösen).</summary>
        public static Button Btn(string text, Func<Task> click, string tip = null, bool primary = false)
        {
            var b = Make(text, tip, primary);
            b.Click += async (s, e) =>
            {
                b.IsEnabled = false;
                try { await click(); } finally { b.IsEnabled = true; }
            };
            return b;
        }

        public static ToggleButton Toggle(string text, Action click, string tip = null)
        {
            var b = new ToggleButton { Content = text, ToolTip = tip, Margin = new Thickness(3) };
            if (!Theme.Loaded) { b.Padding = new Thickness(12, 6, 12, 6); b.Background = Field; b.Foreground = Fg; b.BorderBrush = Line; }
            b.Click += (s, e) => click();
            return b;
        }

        public static TextBox Box(string text = "", double width = 0)
        {
            var t = new TextBox { Text = text, Margin = new Thickness(3), VerticalContentAlignment = VerticalAlignment.Center };
            if (!Theme.Loaded) { t.Padding = new Thickness(6, 4, 6, 4); t.Background = Field; t.Foreground = Fg; t.BorderBrush = Line; t.CaretBrush = Fg; }
            if (width > 0) t.Width = width;
            return t;
        }

        public static StackPanel H(params UIElement[] kids)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        public static StackPanel V(params UIElement[] kids)
        {
            var p = new StackPanel { Orientation = Orientation.Vertical };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        public static WrapPanel Wrap(params UIElement[] kids)
        {
            var p = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        static readonly Brush HeadText = B("#F0F9FF");
        static readonly Brush HeadLine = B("#2138BDF8");

        /// <summary>Karte mit Überschrift wie .panel im Web-Studio (runde Ecken, Leuchtrand, Kopfzeile mit Trennlinie). Der Inhalt füllt
        /// den Rest der Höhe (Tabellen im Inhalt bekommen eine begrenzte Höhe und scrollen selbst).</summary>
        public static Border Card(string title, UIElement body, string hint = null)
        {
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            if (!string.IsNullOrEmpty(title))
                grid.Children.Add(new Border
                {
                    BorderBrush = HeadLine, BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(0, 0, 0, 7), Margin = new Thickness(0, 0, 0, 8),
                    Child = new TextBlock { Text = title, FontWeight = FontWeights.Bold, FontSize = 14, Foreground = HeadText },
                });
            if (!string.IsNullOrEmpty(hint)) { var h = Hint(hint); h.Margin = new Thickness(0, 0, 0, 8); Grid.SetRow(h, 1); grid.Children.Add(h); }
            Grid.SetRow(body, 2);
            grid.Children.Add(body);
            return Panel(grid);
        }

        /// <summary>Rahmen wie .panel ohne Überschrift.</summary>
        public static Border Panel(UIElement child) => new Border
        {
            Background = PanelGradient, BorderBrush = PanelLine, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16),
            Padding = new Thickness(12, 10, 12, 12), Margin = new Thickness(0, 0, 0, 10), Child = child, SnapsToDevicePixels = true,
        };

        /// <summary>Symbol aus der Windows-Symbolschrift (Segoe Fluent Icons / Segoe MDL2 Assets) – schlanke Linien wie im Web-Studio.</summary>
        public static TextBlock Icon(string glyph, double size = 16, Brush fg = null)
        {
            var t = new TextBlock { Text = glyph, FontFamily = IconFont, FontSize = size, VerticalAlignment = VerticalAlignment.Center };
            if (fg != null) t.Foreground = fg;
            return t;
        }

        public static readonly FontFamily IconFont = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");

        public static ComboBox Combo(params string[] items)
        {
            var c = new ComboBox { Margin = new Thickness(3), MinWidth = 140 };
            if (!Theme.Loaded) c.Padding = new Thickness(6, 4, 6, 4);
            foreach (var i in items) c.Items.Add(i);
            if (items.Length > 0) c.SelectedIndex = 0;
            return c;
        }

        /// <summary>Zeile "Name: Wert" für Kennzahlen.</summary>
        public static UIElement Pair(string name, string value)
        {
            var g = new Grid { Margin = new Thickness(0, 2, 0, 2) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var n = Text(name, 13, false, Muted);
            var v = Text(value, 13, false, Fg, true);
            Grid.SetColumn(v, 1);
            g.Children.Add(n);
            g.Children.Add(v);
            return g;
        }

        public static ScrollViewer Scroll(UIElement content) =>
            new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = content, Padding = new Thickness(0, 0, 8, 0) };
    }
}
