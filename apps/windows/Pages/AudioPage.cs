// Audio & Geräte: Soundkarten wie in einer Sendesoftware einrichten – Treiber (WASAPI für alle Windows-Geräte, ASIO für
// Mischpulte/Interfaces), Decks/Cardwall/Programm auf eigene Ausgänge und Kanäle, Mikrofone/Line-In/Bluetooth/
// Mischpult-Summe als Eingänge mit Kanal, Gain und Pegelanzeige, dazu der Mischpult-Betrieb (intern/extern).
// Die Einstellungen gelten für diesen PC (%LOCALAPPDATA%\AnMaChaCast\audio.json), die Technik steckt in Audio/AudioEngine.cs.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using AnMaChaCast.Audio;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class AudioPage : View
    {
        static readonly string File = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast", "audio.json");
        readonly AudioSettings cfg = AudioSettings.Load(File);
        readonly AudioEngine engine;
        readonly Table outputs = new Table(("Signal", 170), ("Gerät", 280), ("Kanäle", 80), ("Lautstärke", 90), ("An", 40));
        readonly Table inputs = new Table(("Eingang", 160), ("Gerät", 260), ("Kanal", 80), ("Gain", 70), ("Pegel", 150), ("An", 40));
        readonly ComboBox driver = Kit.Combo("WASAPI – alle Windows-Geräte (USB, Bluetooth, Klinke, HDMI)", "ASIO – Mischpult / Profi-Interface (geringe Latenz)");
        readonly ComboBox asio = Kit.Combo();
        readonly TextBox buffer = Kit.Box("60", 60);
        readonly CheckBox auto = new CheckBox { Content = "Automatisch mithören (beim Start und sobald gesendet wird)", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) };
        readonly TextBlock state = Kit.Text("Getrennt", 13, true);
        readonly TextBlock warn = Kit.Hint("");
        readonly ComboBox mixer = Kit.Combo("Intern – AnMaCha Cast mischt Decks, Carts und Mikrofon (MIC LIVE)", "Extern – echtes Mischpult: Decks auf eigene Kanäle, gesendet wird der Mischpult-Eingang");
        readonly DispatcherTimer meter = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(150) };
        bool loading;

        public override string Title => "Audio & Geräte";

        /// <summary>Mithören/Audio verbunden (für den Mithören-Schalter in der Kopfzeile).</summary>
        public bool Monitoring => engine.Running;
        public event Action MonitoringChanged;

        public AudioPage(Ctx c) : base(c)
        {
            engine = new AudioEngine(() => C.Api, () => C.StationId);
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            asio.MinWidth = 260;
            Children.Add(Kit.Card("Soundkarte", Kit.V(
                Kit.Wrap(Kit.Text("Treiber"), driver, Kit.Text("ASIO-Treiber"), asio, Kit.Btn("ASIO-Systemsteuerung", AsioPanel),
                    Kit.Btn("ASIO-Treiber installieren …", InstallAsio, "FlexASIO (frei, Open Source) aus dem offiziellen Release laden und installieren – ASIO für jede Soundkarte"),
                    Kit.Text("Puffer (ms)"), buffer, auto),
                Kit.Wrap(Kit.Text("Mischpult"), mixer),
                Kit.Wrap(Kit.Btn("▶ Audio verbinden", Start, "Ausgänge und Eingänge mit dem Server verbinden", true), Kit.Btn("■ Trennen", Stop), Kit.Btn("Geräte neu suchen", () => { FillDrivers(); C.Ok("Geräteliste aktualisiert"); }), state),
                warn),
                "Normale Soundkarten (z. B. Realtek), USB, Bluetooth und Klinke laufen mit WASAPI – ohne Treiber und ohne Einrichtung: ohne eigene Ausgänge hörst du das Programm auf dem Windows-Standardgerät. ASIO nur für Mischpulte/Profi-Interfaces (oder FlexASIO für jede Soundkarte)."));

            // Knöpfe über der Tabelle: bleiben auch bei kleinen Fenstern sichtbar
            var o = Kit.Card("Ausgänge – Decks auf Kanäle", Kit.V(Kit.Wrap(
                Kit.Btn("＋ Ausgang …", () => EditOutput(null), null, true), Kit.Btn("Bearbeiten …", () => EditOutput(outputs.One)), Kit.Btn("Entfernen", () => Remove(outputs, cfg.Outputs)),
                Kit.Btn("Mischpult-Belegung (Deck A 1/2, B 3/4, C 5/6, D 7/8, Cardwall 9/10)", MixerPreset, "Typische Belegung für ein Mischpult am Mehrkanal-Interface")), outputs),
                "Programm = fertige Summe (z. B. Abhöre/Kopfhörer). Decks einzeln, wenn ein echtes Mischpult mischt.");
            SetRow(o, 1);
            Children.Add(o);
            var i = Kit.Card("Eingänge – Mikrofone, Line-In, Mischpult", Kit.V(Kit.Wrap(
                Kit.Btn("＋ Eingang …", () => EditInput(null), null, true), Kit.Btn("Bearbeiten …", () => EditInput(inputs.One)), Kit.Btn("Entfernen", () => Remove(inputs, cfg.Inputs))), inputs),
                "Mehrere Mikrofone werden hier gemischt. Mono-Mikrofon = ein Kanal (mit Panorama), Mischpult-Summe = Stereo-Kanalpaar.");
            SetRow(i, 2);
            Children.Add(i);

            driver.SelectionChanged += (s, e) => { if (!loading) { cfg.Driver = driver.SelectedIndex == 1 ? "asio" : "wasapi"; Save(); Fill(); } };
            asio.SelectionChanged += (s, e) => { if (!loading && asio.SelectedItem is string d) { cfg.AsioDriver = d; Save(); } };
            buffer.LostFocus += (s, e) => { if (int.TryParse(buffer.Text, out var ms)) { cfg.BufferMs = ms; Save(); } buffer.Text = cfg.BufferMs.ToString(); };
            auto.Click += (s, e) => { cfg.AutoStart = auto.IsChecked == true; Save(); };
            mixer.SelectionChanged += async (s, e) => { if (!loading) await SetMixer(mixer.SelectedIndex == 1 ? "external" : "internal"); };
            meter.Tick += (s, e) => UpdateMeters();
            FillDrivers();
            Fill();
        }

        /// <summary>Beim Programmstart (nach der Verbindung zum Server) automatisch verbinden, wenn so eingestellt.</summary>
        public async Task AutoConnect()
        {
            if (!cfg.AutoStart || engine.Running || connecting || !C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            try
            {
                // Abgriffe gibt es nur bei laufender Automation – sonst still warten, bis gesendet wird (playout.state)
                var po = await C.Api.GetJ(C.St("/playout"));
                if (!J.Bool(po, "status.running")) return;
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { return; }
            await Start();
        }

        /// <summary>Server-Ereignis: sobald die Automation läuft, automatisch mithören; endet sie, Audio trennen.</summary>
        public override void OnEvent(string type)
        {
            if (type == "playout.state" || type == "automation.state_changed" || type == "station.changed") _ = AutoConnect();
        }

        /// <summary>Mithören an/aus (Kopfzeile, Live-Studio). Merkt sich die Wahl für den nächsten Start.</summary>
        public async Task SetMonitoring(bool on)
        {
            cfg.AutoStart = on;
            Save();
            auto.IsChecked = on;
            if (on) await Start(); else if (engine.Running) await Stop();
            MonitoringChanged?.Invoke();
        }

        public void Shutdown() => engine.Stop();

        bool connecting;

        public override async Task Show()
        {
            Fill();
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var po = await C.Api.GetJ(C.St("/playout"));
                loading = true;
                mixer.SelectedIndex = J.Str(po, "config.mixer") == "external" ? 1 : 0;
                loading = false;
            }, "Audio");
        }

        void Save()
        {
            try { cfg.Save(File); } catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { C.Status("Audio-Einstellungen nicht gespeichert: " + ex.Message, true); }
        }

        void FillDrivers()
        {
            loading = true;
            asio.Items.Clear();
            foreach (var d in AudioDevices.AsioDrivers()) asio.Items.Add(d);
            if (asio.Items.Count == 0) asio.Items.Add("(kein ASIO-Treiber installiert)");
            asio.SelectedItem = asio.Items.Contains(cfg.AsioDriver) ? cfg.AsioDriver : asio.Items[0];
            loading = false;
        }

        void Fill()
        {
            loading = true;
            driver.SelectedIndex = cfg.Driver == "asio" ? 1 : 0;
            buffer.Text = cfg.BufferMs.ToString();
            auto.IsChecked = cfg.AutoStart;
            loading = false;
            var asioMode = cfg.Driver == "asio";
            var rows = cfg.Outputs.Select(r => new Row(default(JsonElement), AudioTaps.Label(r.Tap), asioMode ? "ASIO: " + cfg.AsioDriver : r.DeviceName,
                r.Mono ? (r.Channel + 1).ToString() : (r.Channel + 1) + "/" + (r.Channel + 2), r.VolumeDb.ToString("0.#") + " dB", r.Enabled ? "✔" : "–")).ToList();
            // ohne eigene Ausgänge: zeigen, was automatisch läuft (nicht bearbeitbar, verschwindet mit dem ersten eigenen Ausgang)
            if (!asioMode && !cfg.Outputs.Any(o => o.Enabled)) rows.Add(new Row(default(JsonElement), "Programm (Summe) – automatisch", "Windows-Standardgerät", "1/2", "0 dB", "✔"));
            outputs.Set(rows);
            var levels = engine.Levels();
            inputs.Set(cfg.Inputs.Select(r => new Row(default(JsonElement), r.Name, asioMode ? "ASIO: " + cfg.AsioDriver : r.DeviceName,
                r.Stereo ? (r.Channel + 1) + "/" + (r.Channel + 2) : (r.Channel + 1).ToString(), r.GainDb.ToString("+0.#;-0.#;0") + " dB", Meter(levels, r.Name), r.Enabled ? "✔" : "–")));
        }

        static string Meter(IList<(string Name, double PeakDb)> levels, string name)
        {
            var hit = levels.Where(l => l.Name == name).Select(l => (double?)l.PeakDb).FirstOrDefault();
            if (hit == null) return "–";
            var db = hit.Value;
            var bars = (int)Math.Round(Math.Max(0, Math.Min(12, (db + 60) / 5)));
            return new string('█', bars) + new string('░', 12 - bars) + (db > -1 ? " CLIP" : "");
        }

        void UpdateMeters()
        {
            if (!IsVisible) return;
            var sel = inputs.SelectedIndex;
            Fill();
            inputs.SelectedIndex = sel;
            ShowWarnings();
        }

        void ShowWarnings()
        {
            lock (engine.Warnings) warn.Text = string.Join("\n", engine.Warnings.Distinct().Take(4));
        }

        // ---------- Verbinden ----------

        async Task Start()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) { C.Status("Erst mit einem Server verbinden", true); return; }
            if (connecting) return;
            connecting = true;
            try
            {
                await C.Run(async () =>
                {
                    // Abgriffe gibt es nur bei laufender Automation (sie hält die Decks)
                    var po = await C.Api.GetJ(C.St("/playout"));
                    if (!J.Bool(po, "status.running")) throw new InvalidOperationException("Es wird noch nicht gesendet – „Sendung starten“ oben rechts, dann hörst du mit");
                    await Task.Run(() => engine.Start(cfg));
                    var drv = engine.Driver;
                    var outs = AudioSettings.EffectiveOutputs(cfg, drv);
                    var ins = AudioSettings.EffectiveInputs(cfg, drv);
                    var standard = drv == "wasapi" && outs.All(o => o.Device.Length == 0 && o.DeviceName.Length == 0);
                    state.Text = "● Verbunden – " + (standard ? "Programm auf dem Windows-Standardgerät" : outs.Count + " Ausgang/Ausgänge") + ", " + ins.Count + " Eingang/Eingänge";
                    meter.Start();
                    ShowWarnings();
                    Fill();
                    C.Ok((standard ? "Mithören: Programm über das Windows-Standardgerät" : "Audio verbunden") + (ins.Count > 0 && mixer.SelectedIndex == 0 ? " – Mikrofon geht mit MIC LIVE auf Sendung" : ""));
                }, "Audio");
            }
            finally { connecting = false; MonitoringChanged?.Invoke(); }
        }

        Task Stop()
        {
            engine.Stop();
            meter.Stop();
            state.Text = "Getrennt";
            Fill();
            C.Ok("Audio getrennt");
            MonitoringChanged?.Invoke();
            return Task.CompletedTask;
        }

        async Task Restart()
        {
            if (engine.Running) { await Stop(); await Start(); }
        }

        Task SetMixer(string mode) => C.Run(async () =>
        {
            await C.Api.PatchJ(C.St("/playout"), new { mixer = mode });
            C.Ok(mode == "external" ? "Externes Mischpult: gesendet wird der Mischpult-Eingang – Decks auf eigene Kanäle legen" : "Internes Mischen: Decks, Carts und Mikrofon mischt AnMaCha Cast");
        }, "Mischpult");

        void AsioPanel()
        {
            if (string.IsNullOrEmpty(cfg.AsioDriver)) { C.Status("Erst einen ASIO-Treiber wählen", true); return; }
            try { AudioDevices.AsioControlPanel(cfg.AsioDriver); }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { C.Status("ASIO: " + ex.Message, true); }
        }

        /// <summary>
        /// FlexASIO (MIT-Lizenz, github.com/dechamps/FlexASIO): ASIO-Treiber für jede Windows-Soundkarte. Lädt das Setup des
        /// neuesten offiziellen Release über HTTPS von GitHub und startet es (Windows fragt nach Administratorrechten).
        /// </summary>
        async Task InstallAsio()
        {
            if (!Dlg.Confirm(C.Owner, "FlexASIO installieren?\n\nFlexASIO ist ein freier ASIO-Treiber (Open Source) für jede Soundkarte, auch Realtek. Für normales Mithören brauchst du ihn nicht – WASAPI reicht.\n\nDas Setup wird aus dem offiziellen Release (github.com/dechamps/FlexASIO) geladen; Windows fragt danach nach Administratorrechten.")) return;
            await C.Run(async () =>
            {
                C.Status("FlexASIO: suche das offizielle Release …", false);
                using (var http = new System.Net.Http.HttpClient())
                {
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("AnMaCha-Cast");
                    http.Timeout = TimeSpan.FromMinutes(5);
                    var json = await http.GetStringAsync("https://api.github.com/repos/dechamps/FlexASIO/releases/latest");
                    var rel = JsonDocument.Parse(json).RootElement;
                    var asset = J.Arr(rel, "assets").FirstOrDefault(a => System.Text.RegularExpressions.Regex.IsMatch(J.Str(a, "name"), @"^FlexASIO-[0-9][0-9.]*\.exe$", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
                    var dl = J.Ok(asset) ? J.Str(asset, "browser_download_url") : "";
                    if (!dl.StartsWith("https://github.com/dechamps/FlexASIO/releases/download/", StringComparison.Ordinal)) throw new InvalidOperationException("Im aktuellen FlexASIO-Release wurde kein Windows-Setup gefunden");
                    var file = Path.Combine(Path.GetTempPath(), "anmachacast-" + J.Str(asset, "name"));
                    C.Status("FlexASIO: lade " + J.Str(asset, "name") + " …", false);
                    using (var res = await http.GetAsync(dl, System.Net.Http.HttpCompletionOption.ResponseHeadersRead))
                    {
                        res.EnsureSuccessStatusCode();
                        using (var src = await res.Content.ReadAsStreamAsync())
                        using (var dst = System.IO.File.Create(file)) await src.CopyToAsync(dst);
                    }
                    var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file) { UseShellExecute = true, Verb = "runas" });
                    if (p != null) await Task.Run(() => p.WaitForExit());
                    try { System.IO.File.Delete(file); } catch (IOException) { }
                }
                FillDrivers();
                C.Ok(AudioDevices.AsioDrivers().Length > 0 ? "ASIO-Treiber installiert – unter „Treiber“ ASIO wählen" : "Setup beendet – kein ASIO-Treiber gefunden (abgebrochen?)");
            }, "ASIO-Treiber");
        }

        // ---------- Ausgänge/Eingänge bearbeiten ----------

        /// <summary>Kanalauswahl als Liste: Stereo-Paare 1/2, 3/4 … oder Einzelkanäle, mit ASIO-Kanalnamen, wenn bekannt.</summary>
        static (string, string)[] ChannelChoices(int count, bool stereo, string[] names)
        {
            var list = new List<(string, string)>();
            var n = Math.Max(2, count);
            for (var ch = 0; ch < n; ch += stereo ? 2 : 1)
            {
                if (stereo && ch + 1 >= n) break;
                var label = stereo ? (ch + 1) + "/" + (ch + 2) : (ch + 1).ToString();
                if (names != null && ch < names.Length && names[ch].Length > 0) label += "  (" + names[ch] + (stereo && ch + 1 < names.Length ? " + " + names[ch + 1] : "") + ")";
                list.Add((ch.ToString(), label));
            }
            return list.ToArray();
        }

        (string, string)[] DeviceChoices(bool capture, out List<AudioDevice> devs)
        {
            devs = AudioDevices.Wasapi(capture);
            return devs.Select(d => (d.Id, d.Name + " · " + d.Channels + " Kanäle")).ToArray();
        }

        Task EditOutput(Row row)
        {
            var idx = row == null ? -1 : outputs.Items.IndexOf(row);
            if (idx >= cfg.Outputs.Count) idx = -1;
            var r = idx >= 0 ? cfg.Outputs[idx] : new OutputRoute { Tap = cfg.Outputs.Any(x => x.Tap == "program") ? "A" : "program" };
            var asioMode = cfg.Driver == "asio";
            var devices = asioMode ? new (string, string)[0] : DeviceChoices(false, out var devs);
            if (!asioMode && devices.Length == 0) { C.Status("Kein Wiedergabegerät gefunden – Lautsprecher/Kopfhörer angeschlossen und in Windows aktiviert?", true); return Task.CompletedTask; }
            var (ins, outs, inNames, outNames) = asioMode ? AudioDevices.AsioChannels(cfg.AsioDriver) : (0, 8, null, null);
            var fields = new List<Field>
            {
                Field.Choice("tap", "Signal", r.Tap, AudioTaps.All),
            };
            if (!asioMode) fields.Add(Field.Choice("device", "Gerät", devices.Any(d => d.Item1 == r.Device) ? r.Device : devices[0].Item1, devices));
            fields.Add(Field.Check("mono", "Mono (ein Kanal, L+R zusammen)", r.Mono));
            fields.Add(Field.Choice("stereoCh", "Kanäle (Stereo)", (r.Channel - r.Channel % 2).ToString(), ChannelChoices(outs, true, outNames)));
            fields.Add(Field.Choice("monoCh", "Kanal (Mono)", r.Channel.ToString(), ChannelChoices(outs, false, outNames)));
            fields.Add(Field.Text("volume", "Lautstärke (dB, −60 … +12)", r.VolumeDb.ToString("0.#")));
            fields.Add(Field.Check("enabled", "An", r.Enabled));
            if (!asioMode) fields.Add(Field.Info("Hinweis", "Wie viele Kanäle ein Gerät hat, zeigt die Liste. Kanäle über der Gerätegrenze bleiben still."));
            var v = Dlg.Form(C.Owner, idx >= 0 ? "Ausgang bearbeiten" : "Ausgang hinzufügen", "Speichern", fields.ToArray());
            if (v == null) return Task.CompletedTask;
            r.Tap = v["tap"];
            if (!asioMode) { r.Device = v["device"]; r.DeviceName = AudioDevices.Wasapi(false).FirstOrDefault(d => d.Id == r.Device)?.Name ?? ""; }
            r.Mono = v["mono"] == "true";
            r.Channel = int.TryParse(r.Mono ? v["monoCh"] : v["stereoCh"], out var ch) ? ch : 0;
            r.VolumeDb = double.TryParse(v["volume"].Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var db) ? db : 0;
            r.Enabled = v["enabled"] == "true";
            if (idx < 0) cfg.Outputs.Add(r);
            AudioSettings.Sanitize(cfg);
            Save();
            Fill();
            return Restart();
        }

        Task EditInput(Row row)
        {
            var idx = row == null ? -1 : inputs.Items.IndexOf(row);
            var r = idx >= 0 ? cfg.Inputs[idx] : new InputRoute { Name = "Mikrofon " + (cfg.Inputs.Count + 1) };
            var asioMode = cfg.Driver == "asio";
            var devices = asioMode ? new (string, string)[0] : DeviceChoices(true, out var devs);
            if (!asioMode && devices.Length == 0) { C.Status("Kein Aufnahmegerät gefunden – Mikrofon/Interface angeschlossen und in Windows (Datenschutz → Mikrofon) erlaubt?", true); return Task.CompletedTask; }
            var (ins, outs, inNames, outNames) = asioMode ? AudioDevices.AsioChannels(cfg.AsioDriver) : (8, 0, null, null);
            var fields = new List<Field> { Field.Text("name", "Name", r.Name) };
            if (!asioMode) fields.Add(Field.Choice("device", "Gerät", devices.Any(d => d.Item1 == r.Device) ? r.Device : devices[0].Item1, devices));
            fields.Add(Field.Check("stereo", "Stereo (Kanalpaar, z. B. Mischpult-Summe)", r.Stereo));
            fields.Add(Field.Choice("monoCh", "Kanal (Mono-Mikrofon)", r.Channel.ToString(), ChannelChoices(ins, false, inNames)));
            fields.Add(Field.Choice("stereoCh", "Kanäle (Stereo)", (r.Channel - r.Channel % 2).ToString(), ChannelChoices(ins, true, inNames)));
            fields.Add(Field.Text("gain", "Gain (dB, −30 … +30)", r.GainDb.ToString("0.#")));
            fields.Add(Field.Choice("pan", "Panorama (Mono)", r.Pan < -0.3 ? "-1" : r.Pan > 0.3 ? "1" : "0", ("-1", "Links"), ("0", "Mitte"), ("1", "Rechts")));
            fields.Add(Field.Check("enabled", "An", r.Enabled));
            var v = Dlg.Form(C.Owner, idx >= 0 ? "Eingang bearbeiten" : "Eingang hinzufügen", "Speichern", fields.ToArray());
            if (v == null) return Task.CompletedTask;
            r.Name = v["name"].Trim().Length > 0 ? v["name"].Trim() : "Eingang";
            if (!asioMode) { r.Device = v["device"]; r.DeviceName = AudioDevices.Wasapi(true).FirstOrDefault(d => d.Id == r.Device)?.Name ?? ""; }
            r.Stereo = v["stereo"] == "true";
            r.Channel = int.TryParse(r.Stereo ? v["stereoCh"] : v["monoCh"], out var ch) ? ch : 0;
            r.GainDb = double.TryParse(v["gain"].Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var g) ? g : 0;
            r.Pan = double.TryParse(v["pan"], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p) ? p : 0;
            r.Enabled = v["enabled"] == "true";
            if (idx < 0) cfg.Inputs.Add(r);
            AudioSettings.Sanitize(cfg);
            Save();
            Fill();
            return Restart();
        }

        Task Remove<T>(Table t, List<T> list)
        {
            var idx = t.SelectedIndex;
            if (idx < 0 || idx >= list.Count) { C.Status("Bitte eine Zeile markieren", true); return Task.CompletedTask; }
            list.RemoveAt(idx);
            Save();
            Fill();
            return Restart();
        }

        /// <summary>Typische Mischpult-Belegung am Mehrkanal-Interface (ASIO) bzw. auf dem gewählten Gerät.</summary>
        Task MixerPreset()
        {
            var dev = cfg.Outputs.FirstOrDefault(o => o.Device.Length > 0);
            var device = dev?.Device ?? "";
            var name = dev?.DeviceName ?? "";
            if (cfg.Driver != "asio" && device.Length == 0)
            {
                var list = AudioDevices.Wasapi(false).Where(d => d.Channels >= 4).ToList();
                if (list.Count == 0) { C.Status("Kein Mehrkanal-Gerät gefunden – für ein Mischpult ASIO wählen oder ein Interface mit 8+ Kanälen anschließen", true); return Task.CompletedTask; }
                device = list[0].Id;
                name = list[0].Name;
            }
            if (cfg.Outputs.Count > 0 && !Dlg.Confirm(C.Owner, "Bestehende Ausgänge durch die Mischpult-Belegung ersetzen?")) return Task.CompletedTask;
            cfg.Outputs = new[] { "A", "B", "C", "D", "carts" }.Select((tap, i) => new OutputRoute { Tap = tap, Channel = i * 2, Device = device, DeviceName = name }).ToList();
            Save();
            Fill();
            C.Ok("Mischpult-Belegung eingerichtet – unter „Mischpult“ auf „Extern“ stellen, wenn das Pult die Summe zurückschickt");
            return Restart();
        }
    }
}
