// Sendebedienung in der Kopfzeile wie im Web-Studio (.onair, .top-now, .mode-switch, #btn-mic): ON-AIR-Anzeige, „Jetzt läuft“
// mit Laufzeit, Betriebsart Manuell | 24/7 AutoDJ, MIC LIVE und Sendung starten/stoppen. Gilt für jede Seite, nicht nur das
// Studio. Alle Werte kommen vom Server (Betriebsart, Playout, now-playing) – ohne Verbindung steht „OFF AIR“, nichts Erfundenes.
using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;

namespace AnMaChaCast.Ui
{
    sealed class OnAirBar
    {
        readonly Ctx c;
        readonly DispatcherTimer poll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        readonly DispatcherTimer tick = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };

        readonly System.Windows.Shapes.Ellipse dot = new System.Windows.Shapes.Ellipse { Width = 9, Height = 9, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock onAirText = Kit.Text("OFF AIR", 12, true);
        readonly TextBlock nowLabel = new TextBlock { Text = "JETZT LÄUFT", FontSize = 9.5, FontWeight = FontWeights.SemiBold, Foreground = Kit.Muted };
        readonly TextBlock nowTitle = Kit.Text("–", 13, true);
        readonly TextBlock nowArtist = Kit.Text("", 11, false, Kit.Muted);
        readonly TextBlock nowTime = new TextBlock { FontSize = 11, Foreground = Kit.Muted, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        readonly TextBlock cover = new TextBlock { FontWeight = FontWeights.Black, FontSize = 13, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };

        public readonly Border OnAir = new Border { CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), Padding = new Thickness(13, 0, 13, 0), MinHeight = 38, VerticalAlignment = VerticalAlignment.Center };
        public readonly Border Now = new Border { CornerRadius = new CornerRadius(9), BorderThickness = new Thickness(1), Padding = new Thickness(8, 5, 12, 5), VerticalAlignment = VerticalAlignment.Center, MinWidth = 240 };
        public readonly Border Modes;
        public readonly ToggleButton Mic;
        public readonly Button Stream;
        readonly ToggleButton auto;
        readonly ToggleButton manual;

        long? startedAt;
        long? durationMs;
        bool micOn;
        bool busRunning;
        bool busy;

        public OnAirBar(Ctx ctx)
        {
            c = ctx;
            OnAir.Child = Kit.H(dot, onAirText);

            var tile = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 10, 0), Child = cover, Background = Theme.Linear(135, (Theme.C("#1E3A5F"), 0), (Theme.C("#2B2F6B"), 1)) };
            var texts = Kit.V(nowLabel, nowTitle);
            texts.VerticalAlignment = VerticalAlignment.Center;
            var row = new DockPanel();
            DockPanel.SetDock(tile, Dock.Left);
            DockPanel.SetDock(nowTime, Dock.Right);
            row.Children.Add(tile);
            row.Children.Add(nowTime);
            row.Children.Add(texts);
            Now.Child = row;
            Now.BorderBrush = Theme.Solid(Theme.C("#3338BDF8"));
            Now.Background = Theme.Linear(135, (Theme.C("#B30A1A33"), 0), (Theme.C("#B3121640"), 1));
            Now.ToolTip = nowArtist;

            manual = Kit.Toggle("Manuell", () => _ = SetMode("MANUAL"), "Selbst live fahren");
            auto = Kit.Toggle("24/7 AutoDJ", () => _ = SetMode("AUTO"), "Automation sendet rund um die Uhr");
            foreach (var b in new[] { manual, auto }) { b.Margin = new Thickness(0); Theme.Use(b, b == auto ? "Seg.Auto" : "Seg.Manual"); }
            Modes = new Border
            {
                CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1), BorderBrush = Kit.Line, Background = Theme.Solid(Theme.C("#CC06152A")),
                VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left, Child = Kit.H(manual, new Border { Width = 1, Background = Kit.Line }, auto),
            };
            Modes.Loaded += (s, e) => Modes.Clip = new RectangleGeometry(new Rect(0, 0, Modes.ActualWidth, Modes.ActualHeight), 8, 8);

            Mic = Kit.Toggle("MIC LIVE", () => _ = ToggleMic(), "Mikrofon live senden (Übernahme nach Priorität)");
            Theme.Use(Mic, "Toggle.Live");
            Mic.Content = Kit.H(Kit.Icon("", 13), new TextBlock { Text = "MIC LIVE", Margin = new Thickness(7, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            Stream = Kit.Btn("Sendung starten", ToggleStream, "Server-Playout starten oder stoppen");

            poll.Tick += (s, e) => { if (c.Owner?.IsVisible == true && c.Connected) _ = Refresh(); };
            tick.Tick += (s, e) => ShowTime();
            Clear();
        }

        public void Start() { poll.Start(); tick.Start(); }

        /// <summary>Ohne Verbindung: neutrale Anzeige, Bedienung gesperrt.</summary>
        public void Clear()
        {
            SetOnAir("OFF AIR", Theme.C("#8A9BB8"), Theme.C("#8A9BB8"));
            nowTitle.Text = "–";
            nowArtist.Text = "";
            cover.Text = "";
            startedAt = null;
            durationMs = null;
            nowTime.Text = "";
            auto.IsChecked = manual.IsChecked = Mic.IsChecked = false;
            foreach (var el in new UIElement[] { auto, manual, Mic, Stream }) el.IsEnabled = false;
        }

        public async Task Refresh()
        {
            if (!c.Connected || string.IsNullOrEmpty(c.StationId) || busy) return;
            busy = true;
            try
            {
                var mode = c.Api.Mode(c.StationId);
                var playout = c.Api.Playout(c.StationId);
                var now = c.Api.GetJ(c.St("/now-playing"));
                try { await Task.WhenAll(mode, playout, now); } catch (Exception ex) when (ex is ApiException || ex is TaskCanceledException) { }
                foreach (var el in new UIElement[] { auto, manual, Mic, Stream }) el.IsEnabled = true;
                if (mode.Status == TaskStatus.RanToCompletion) ApplyMode(mode.Result);
                if (playout.Status == TaskStatus.RanToCompletion) ApplyPlayout(playout.Result);
                if (now.Status == TaskStatus.RanToCompletion) ApplyNow(now.Result);
            }
            finally { busy = false; }
        }

        public void OnEvent(string type)
        {
            if (type == "now_playing.changed" || type == "automation.state_changed" || type == "station.changed" || type == "playout.state" || type == "deck.state_changed")
                _ = Refresh();
        }

        void SetOnAir(string text, Color color, Color fg)
        {
            onAirText.Text = text;
            onAirText.Foreground = Theme.Solid(fg);
            dot.Fill = Theme.Solid(color);
            OnAir.BorderBrush = Theme.Solid(Theme.Alpha(color, 0.5));
            OnAir.Background = Theme.Solid(Theme.Alpha(color, 0.12));
        }

        void ApplyMode(ModeView m)
        {
            if (m == null) return;
            auto.IsChecked = m.Base == "AUTO";
            manual.IsChecked = m.Base == "MANUAL";
            if (m.mode == "LIVE") SetOnAir("ON AIR · LIVE" + (string.IsNullOrEmpty(m.live) ? "" : " · " + m.live), Theme.C("#EF4444"), Theme.C("#FECACA"));
            else if (m.mode == "EMERGENCY") SetOnAir("ON AIR · NOTFALL", Theme.C("#F59E0B"), Theme.C("#FDE68A"));
            else if (m.mode == "AUTO") SetOnAir("AUTODJ · ON AIR", Theme.C("#22C55E"), Theme.C("#86EFAC"));
            else if (m.mode == "MANUAL") SetOnAir("MANUELL · ON AIR", Theme.C("#EAB308"), Theme.C("#FDE68A"));
            else SetOnAir(string.IsNullOrEmpty(m.mode) ? "OFF AIR" : m.mode, Theme.C("#8A9BB8"), Theme.C("#8A9BB8"));
        }

        void ApplyPlayout(PlayoutView p)
        {
            busRunning = p?.status?.running == true;
            micOn = p?.status?.micOn == true;
            Mic.IsChecked = micOn;
            Stream.Content = busRunning ? "Sendung stoppen" : "Sendung starten";
            Theme.Use(Stream, busRunning ? "Btn.Danger" : "Btn.Primary");
        }

        void ApplyNow(JsonElement n)
        {
            var title = J.Str(n, "media.title");
            var artist = J.Str(n, "media.artist");
            nowTitle.Text = title.Length > 0 ? title : "–";
            nowArtist.Text = artist.Length > 0 ? artist + " – " + title : title;
            var t = (artist.Length > 0 ? artist : title).Trim();
            cover.Text = t.Length > 0 ? char.ToUpperInvariant(t[0]).ToString() : "";
            startedAt = J.Ok(J.At(n, "startedAt")) ? J.Long(n, "startedAt") : (long?)null;
            durationMs = J.Ok(J.At(n, "media.durationMs")) ? J.Long(n, "media.durationMs") : (long?)null;
            ShowTime();
        }

        void ShowTime()
        {
            if (startedAt == null || nowTitle.Text == "–") { nowTime.Text = ""; return; }
            var pos = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - startedAt.Value);
            if (durationMs is long d && d > 0) pos = Math.Min(pos, d);
            nowTime.Text = Fmt.Dur(pos) + (durationMs is long dd && dd > 0 ? " / " + Fmt.Dur(dd) : "");
        }

        async Task SetMode(string mode)
        {
            if (!c.Connected) return;
            await c.Run(async () => ApplyMode(await c.Api.SetMode(c.StationId, mode)), "Betriebsart");
            await Refresh();
        }

        async Task ToggleMic()
        {
            if (!c.Connected) return;
            await c.Run(async () => { await c.Api.SetMic(c.StationId, !micOn); ApplyPlayout(await c.Api.Playout(c.StationId)); }, "Mikrofon");
        }

        async Task ToggleStream()
        {
            if (!c.Connected) return;
            await c.Run(async () =>
            {
                if (busRunning)
                {
                    if (!Dlg.Confirm(c.Owner, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.")) return;
                    ApplyPlayout(await c.Api.StopPlayout(c.StationId));
                }
                else ApplyPlayout(await c.Api.StartPlayout(c.StationId));
            }, "Sendung");
            await Refresh();
        }
    }
}
