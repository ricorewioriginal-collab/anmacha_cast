// Optik des Web-Studios für das native Fenster: lädt Ui/Theme.xaml (Stile für Knöpfe, Felder, Listen, Reiter …) in die
// Anwendung, färbt die Titelleiste dunkel und liefert die Wortmarke. Theme.xaml wird zur Laufzeit gelesen, damit die
// Oberfläche weiter ohne XAML-Compiler gebaut und unter Linux geprüft werden kann (apps/windows/check).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace AnMaChaCast.Ui
{
    static class Theme
    {
        /// <summary>Fehlertext, falls das Design nicht geladen werden konnte (das Programm läuft dann mit Windows-Standardoptik).</summary>
        public static string Error { get; private set; }

        public static bool Loaded { get; private set; }

        public static void Apply(Application app)
        {
            try
            {
                using (var s = typeof(Theme).Assembly.GetManifestResourceStream("AnMaChaCast.Theme.xaml"))
                {
                    if (s == null) { Error = "Theme.xaml fehlt im Programm"; return; }
                    app.Resources.MergedDictionaries.Add((ResourceDictionary)XamlReader.Load(s));
                    Loaded = true;
                }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                Error = ex.Message;
            }
        }

        /// <summary>Benannten Stil aus Theme.xaml setzen (bleibt ohne Design wirkungslos statt zu stören).</summary>
        public static void Use(FrameworkElement el, string key)
        {
            if (Loaded) el.SetResourceReference(FrameworkElement.StyleProperty, key);
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        /// <summary>Dunkle Titelleiste wie die Seitenfarbe (Windows 10 ab 1809: dunkel; Windows 11 zusätzlich exakt #050A14).</summary>
        public static void DarkTitle(Window w)
        {
            w.SourceInitialized += (s, e) =>
            {
                try
                {
                    var h = new WindowInteropHelper(w).Handle;
                    var on = 1;
                    if (DwmSetWindowAttribute(h, 20, ref on, 4) != 0) DwmSetWindowAttribute(h, 19, ref on, 4);
                    var caption = 0x00140A05; // COLORREF (0x00BBGGRR) von #050A14
                    DwmSetWindowAttribute(h, 35, ref caption, 4);
                    var text = 0x00F8EDE6; // #E6EDF8
                    DwmSetWindowAttribute(h, 36, ref text, 4);
                }
                catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException) { }
            };
        }

        /// <summary>Wortmarke „AnMaCha Cast“ (studio/icons/wordmark.png), passend klein dekodiert; null, wenn nicht eingebettet.</summary>
        public static ImageSource Wordmark(int width)
        {
            try
            {
                using (var s = typeof(Theme).Assembly.GetManifestResourceStream("AnMaChaCast.wordmark.png"))
                {
                    if (s == null) return null;
                    var img = new BitmapImage();
                    img.BeginInit();
                    img.CacheOption = BitmapCacheOption.OnLoad;
                    img.DecodePixelWidth = width;
                    img.StreamSource = s;
                    img.EndInit();
                    img.Freeze();
                    return img;
                }
            }
            catch (Exception ex) when (ex is IOException || ex is NotSupportedException || ex is InvalidOperationException) { return null; }
        }

        // ---------- Farben ----------

        public static Color C(string hex) => (Color)ColorConverter.ConvertFromString(hex);

        public static SolidColorBrush Solid(Color c) { var b = new SolidColorBrush(c); b.Freeze(); return b; }

        public static Color Alpha(Color c, double a) => Color.FromArgb((byte)Math.Round(255 * a), c.R, c.G, c.B);

        /// <summary>Wie CSS color-mix(in srgb, a share, b).</summary>
        public static Color Mix(Color a, double share, Color b) => Color.FromRgb(
            (byte)Math.Round(a.R * share + b.R * (1 - share)), (byte)Math.Round(a.G * share + b.G * (1 - share)), (byte)Math.Round(a.B * share + b.B * (1 - share)));

        public static LinearGradientBrush Linear(double angleDeg, params (Color Color, double Offset)[] stops)
        {
            // CSS-Winkel: 0° = nach oben, 90° = nach rechts, 180° = nach unten
            var r = angleDeg * Math.PI / 180;
            var dx = Math.Sin(r) / 2;
            var dy = -Math.Cos(r) / 2;
            var g = new LinearGradientBrush { StartPoint = new Point(0.5 - dx, 0.5 - dy), EndPoint = new Point(0.5 + dx, 0.5 + dy) };
            foreach (var s in stops) g.GradientStops.Add(new GradientStop(s.Color, s.Offset));
            g.Freeze();
            return g;
        }
    }
}
