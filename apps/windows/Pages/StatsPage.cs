// Statistik: Hörer und gespielte Titel für wählbare Zeiträume, Top-Listen, Verlauf, CSV-Export.
using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class StatsPage : View
    {
        static readonly (string Id, string Label)[] Periods = { ("today", "Heute"), ("24h", "24 Stunden"), ("7d", "7 Tage"), ("30d", "30 Tage"), ("3m", "3 Monate") };

        readonly StackPanel kpis = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
        readonly Table played = new Table(("Zeit", 120), ("Titel", 260), ("Interpret", 180), ("Hörer", 60), ("Live", 50));
        readonly Table top = new Table(("Titel", 280), ("Interpret", 190), ("Einsätze", 70), ("Ø Hörer", 70));
        readonly Table artists = new Table(("Interpret", 300), ("Einsätze", 80));
        readonly Table series = new Table(("Zeit", 150), ("Ø Hörer", 80), ("Spitze", 80));
        readonly Table genres = new Table(("Genre", 300), ("Einsätze", 80));
        string period = "7d";

        public override string Title => "Statistik";

        public StatsPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            var chips = Kit.Wrap();
            foreach (var p in Periods)
            {
                var id = p.Id;
                chips.Children.Add(Kit.Btn(p.Label, () => { period = id; return Load(); }));
            }
            chips.Children.Add(Kit.Btn("CSV speichern …", SaveCsv, "Ausführliche Statistik als CSV-Datei"));
            Children.Add(Kit.V(chips, kpis));

            var tabs = new TabControl { Background = Kit.PanelGradient, BorderBrush = Kit.PanelLine };
            tabs.Items.Add(new TabItem { Header = "Gespielt", Content = played });
            tabs.Items.Add(new TabItem { Header = "Top-Songs", Content = top });
            tabs.Items.Add(new TabItem { Header = "Top-Interpreten", Content = artists });
            tabs.Items.Add(new TabItem { Header = "Hörer-Verlauf", Content = series });
            tabs.Items.Add(new TabItem { Header = "Genres", Content = genres });
            SetRow(tabs, 1);
            Children.Add(tabs);
        }

        public override Task Show() => Load();

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var s = await C.Api.GetJ(C.St("/stats?period=" + period), 40);
                var k = J.Get(s, "kpis");
                kpis.Children.Clear();
                kpis.Children.Add(Kit.Card("Zeitraum: " + Periods.First(p => p.Id == period).Label, Kit.V(
                    Kit.Pair("Hörer jetzt", J.Str(k, "listenersNow")), Kit.Pair("Gespielte Titel", J.Str(k, "played")), Kit.Pair("Verschiedene Titel", J.Str(k, "uniqueSongs")),
                    Kit.Pair("Ø Hörer je Titel", J.Str(k, "avgPerSong", "–")), Kit.Pair("Spitze", J.Str(k, "peak")), Kit.Pair("Live-Einsätze", J.Str(k, "livePlays")),
                    Kit.Pair("Stunden On Air", J.Str(k, "hoursOnAir")),
                    Kit.Pair("Top-Song", J.Ok(J.Get(k, "topSong")) ? J.Str(k, "topSong.artist") + " – " + J.Str(k, "topSong.title") + " (" + J.Str(k, "topSong.plays") + "×)" : "–"))));
                played.Set(J.Arr(s, "played").Reverse().Take(1000).Select(p => new Row(p, Fmt.Stamp(J.Long(p, "at")), J.Str(p, "title"), J.Str(p, "artist"), J.Str(p, "listeners", "–"), J.Bool(p, "live") ? "live" : "")));
                top.Set(J.Arr(s, "topSongs").Select(p => new Row(p, J.Str(p, "title"), J.Str(p, "artist"), J.Str(p, "plays"), J.Str(p, "avgListeners", "–"))));
                artists.Set(J.Arr(s, "topArtists").Select(p => new Row(p, J.Str(p, "artist"), J.Str(p, "plays"))));
                series.Set(J.Arr(s, "series").Select(p => new Row(p, Fmt.Stamp(J.Long(p, "at")), J.Str(p, "avg"), J.Str(p, "peak"))));
                genres.Set(J.Arr(s, "genres").Select(p => new Row(p, J.Str(p, "genre"), J.Str(p, "plays"))));
            }, "Statistik");
        }

        async Task SaveCsv()
        {
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "statistik-" + period + ".csv", Filter = "CSV|*.csv" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            await C.Run(async () => { System.IO.File.WriteAllBytes(dlg.FileName, await C.Api.Download(C.St("/stats/deep.csv?period=" + period))); C.Ok("Gespeichert: " + dlg.FileName); }, "CSV");
        }
    }
}
