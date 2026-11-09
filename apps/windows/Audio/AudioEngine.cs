// Soundkarten-Routing der Windows-App mit NAudio: WASAPI (alle Windows-Geräte: USB, Bluetooth, Klinke, HDMI) oder
// ASIO (ein Treiber für Mischpulte/Profi-Interfaces, geringe Latenz).
//  • Ausgänge: Programm, Deck A–D und Cardwall kommen als PCM vom Server (GET /audio/taps/{id}) und gehen auf frei
//    gewählte Geräte und Kanäle (z. B. Deck A → Kanal 1/2, Deck B → 3/4 ins Mischpult).
//  • Eingänge: Mikrofone, Line-In/Klinke, Bluetooth-Headset oder die Mischpult-Summe – je Kanal gewählt, gepegelt,
//    gemischt und als ein Stereo-Strom an den Server (PUT /audio/input). Ob das Mikrofon auf Sendung ist, entscheidet
//    MIC LIVE (internes Mischen) bzw. bei „externem Mischpult“ ist dieser Eingang das Programm.
// Server und Soundkarte haben eigene Takte: die Puffer werden auf kurze Latenz begrenzt (AudioMath.BytesToDrop).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Security;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace AnMaChaCast.Audio
{
    sealed class AudioDevice
    {
        public string Id = "";
        public string Name = "";
        public int Channels;
        public int Rate;
    }

    /// <summary>Geräteliste: WASAPI-Endpunkte (aktiv) und ASIO-Treiber.</summary>
    static class AudioDevices
    {
        public static List<AudioDevice> Wasapi(bool capture)
        {
            var list = new List<AudioDevice>();
            try
            {
                using (var en = new MMDeviceEnumerator())
                    foreach (var d in en.EnumerateAudioEndPoints(capture ? DataFlow.Capture : DataFlow.Render, DeviceState.Active))
                    {
                        var mf = SafeMixFormat(d);
                        list.Add(new AudioDevice { Id = d.ID, Name = d.FriendlyName, Channels = mf?.Channels ?? 2, Rate = mf?.SampleRate ?? 48000 });
                    }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { }
            return list;
        }

        static WaveFormat SafeMixFormat(MMDevice d)
        {
            try { return d.AudioClient.MixFormat; } catch (Exception ex) when (!(ex is OutOfMemoryException)) { return null; }
        }

        public static string[] AsioDrivers()
        {
            try { return AsioOut.isSupported() ? AsioOut.GetDriverNames() : new string[0]; }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { return new string[0]; }
        }

        /// <summary>Ein- und Ausgangskanäle eines ASIO-Treibers samt Kanalnamen (öffnet den Treiber kurz).</summary>
        public static (int In, int Out, string[] InNames, string[] OutNames) AsioChannels(string driver)
        {
            try
            {
                using (var a = new AsioOut(driver))
                {
                    var ins = Enumerable.Range(0, a.DriverInputChannelCount).Select(a.AsioInputChannelName).ToArray();
                    var outs = Enumerable.Range(0, a.DriverOutputChannelCount).Select(a.AsioOutputChannelName).ToArray();
                    return (ins.Length, outs.Length, ins, outs);
                }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { return (0, 0, new string[0], new string[0]); }
        }

        public static void AsioControlPanel(string driver)
        {
            using (var a = new AsioOut(driver)) a.ShowControlPanel();
        }
    }

    /// <summary>Ein Abgriff vom Server als PCM-Puffer (s16le 44,1 kHz Stereo) – füllt sich im Hintergrund, verbindet neu.</summary>
    sealed class TapSource : IDisposable
    {
        public readonly BufferedWaveProvider Buffer = new BufferedWaveProvider(new WaveFormat(AudioMath.ServerRate, 16, AudioMath.ServerChannels))
        {
            BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true, ReadFully = true,
        };
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        public string Error = "";

        public TapSource(Func<ApiClient> api, string stationId, string tap)
        {
            Task.Run(async () =>
            {
                var path = "/stations/" + Uri.EscapeDataString(stationId) + "/audio/taps/" + Uri.EscapeDataString(tap);
                var buf = new byte[8192];
                var bps = AudioMath.ServerRate * 4;
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        var (body, fmt) = await api().OpenStream(path, cts.Token);
                        if (fmt.Replace(" ", "") != AudioMath.ServerFormat) { Error = "Unerwartetes Format vom Server: " + fmt; return; }
                        Error = "";
                        using (body)
                        {
                            int n;
                            while ((n = await body.ReadAsync(buf, 0, buf.Length, cts.Token)) > 0)
                            {
                                Buffer.AddSamples(buf, 0, n);
                                var drop = AudioMath.BytesToDrop(Buffer.BufferedBytes, bps, 4);
                                if (drop > 0) DropBytes(drop);
                            }
                        }
                    }
                    catch (Exception ex) when (!(ex is OutOfMemoryException)) { if (!cts.IsCancellationRequested) Error = ex.Message; }
                    if (!cts.IsCancellationRequested) await Task.Delay(1500).ContinueWith(_ => { });
                }
            });
        }

        void DropBytes(int n)
        {
            var tmp = new byte[Math.Min(n, 65536)];
            while (n > 0) { var r = Buffer.Read(tmp, 0, Math.Min(n, tmp.Length)); if (r <= 0) break; n -= r; }
        }

        public void Dispose() { cts.Cancel(); cts.Dispose(); }
    }

    /// <summary>Eingangskanäle eines Geräts → je Eingang ein Stereo-Puffer im Gerätetakt.</summary>
    sealed class InputBranch
    {
        public readonly InputRoute Route;
        public readonly BufferedWaveProvider Buffer;
        public double PeakDb = -90;
        float[] stereo = new float[0];

        public InputBranch(InputRoute route, int deviceRate)
        {
            Route = route;
            Buffer = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(deviceRate, 2)) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true, ReadFully = true };
        }

        public void Feed(float[] block, int frames, int deviceChannels)
        {
            if (stereo.Length < frames * 2) stereo = new float[frames * 2];
            AudioMath.ExtractStereo(block, frames, deviceChannels, Route, stereo);
            PeakDb = AudioMath.PeakDb(stereo, frames * 2);
            var bytes = new byte[frames * 8];
            System.Buffer.BlockCopy(stereo, 0, bytes, 0, bytes.Length);
            Buffer.AddSamples(bytes, 0, bytes.Length);
            // Soundkarte schneller als der Sendetakt: Vorlauf kurz halten (Mikrofon soll nicht nachhallen)
            var bps = Buffer.WaveFormat.AverageBytesPerSecond;
            var drop = AudioMath.BytesToDrop(Buffer.BufferedBytes, bps, 8, 250, 80);
            if (drop > 0) { var tmp = new byte[drop]; Buffer.Read(tmp, 0, drop); }
        }
    }

    sealed class AudioEngine : IDisposable
    {
        readonly Func<ApiClient> api;
        readonly Func<string> station;
        readonly List<IDisposable> parts = new List<IDisposable>();
        readonly List<InputBranch> branches = new List<InputBranch>();
        CancellationTokenSource upload;
        public bool Running { get; private set; }
        public readonly List<string> Warnings = new List<string>();

        public AudioEngine(Func<ApiClient> api, Func<string> station)
        {
            this.api = api;
            this.station = station;
        }

        /// <summary>Pegel der Eingänge (Name → dBFS) für die Anzeige.</summary>
        public IList<(string Name, double PeakDb)> Levels() => branches.Select(b => (b.Route.Name, b.PeakDb)).ToList();

        /// <summary>Tatsächlich genutzter Treiber des letzten Starts ("wasapi"/"asio").</summary>
        public string Driver { get; private set; } = "wasapi";

        public void Start(AudioSettings s)
        {
            Stop();
            Warnings.Clear();
            Driver = AudioSettings.EffectiveDriver(s, AudioDevices.AsioDrivers().Length > 0);
            if (s.Driver == "asio" && Driver != "asio") Warnings.Add("Kein ASIO-Treiber installiert – es läuft WASAPI über das Windows-Standardgerät");
            var outs = AudioSettings.EffectiveOutputs(s, Driver);
            var ins = AudioSettings.EffectiveInputs(s, Driver);
            try
            {
                if (Driver == "asio") StartAsio(s, outs, ins);
                else StartWasapi(s, outs, ins);
                if (ins.Count > 0) StartUpload();
                Running = true;
            }
            catch
            {
                Stop();
                throw;
            }
        }

        public void Stop()
        {
            upload?.Cancel();
            upload = null;
            foreach (var p in parts.AsEnumerable().Reverse()) { try { p.Dispose(); } catch (Exception ex) when (!(ex is OutOfMemoryException)) { } }
            parts.Clear();
            branches.Clear();
            Running = false;
        }

        public void Dispose() => Stop();

        // ---------- Ausgänge ----------

        /// <summary>Quelle einer Route im Zieltakt: Abgriff → (Mono) → Lautstärke → Resampler.</summary>
        ISampleProvider RouteSource(OutputRoute r, int rate)
        {
            var tap = new TapSource(api, station(), r.Tap);
            parts.Add(tap);
            ISampleProvider p = tap.Buffer.ToSampleProvider();
            if (r.Mono) p = p.ToMono(0.5f, 0.5f);
            p = new VolumeSampleProvider(p) { Volume = AudioMath.DbToGain(r.VolumeDb) };
            if (rate != AudioMath.ServerRate) p = new WdlResamplingSampleProvider(p, rate);
            return p;
        }

        /// <summary>Alle Routen eines Geräts auf dessen Kanäle legen; nicht belegte Kanäle bleiben still.</summary>
        ISampleProvider DeviceMix(IList<OutputRoute> routes, int rate, int channels, string deviceName)
        {
            var sources = routes.Select(r => RouteSource(r, rate)).ToList();
            var map = AudioMath.ChannelMap(routes, channels);
            var used = routes.Sum(r => r.Mono ? 1 : 2);
            if (map.Count < used) Warnings.Add(deviceName + ": nur " + channels + " Kanäle – " + (used - map.Count) + " Kanal/Kanäle der Belegung passen nicht");
            // Stille-Quelle als letzter Eingang: alle nicht belegten Gerätekanäle zeigen darauf (sonst würde der
            // Multiplexer sie standardmäßig mit gleichnummerigen Quellkanälen belegen)
            sources.Add(new SilenceProvider(WaveFormat.CreateIeeeFloatWaveFormat(rate, 1)).ToSampleProvider());
            var mux = new MultiplexingSampleProvider(sources, channels);
            var silence = used;
            for (var ch = 0; ch < channels; ch++) mux.ConnectInputToOutput(silence, ch);
            // Mehrere Routen auf demselben Kanal: der Multiplexer kann nur eine Quelle je Kanal – die letzte gewinnt
            foreach (var (src, target) in map) mux.ConnectInputToOutput(src, target);
            if (map.GroupBy(m => m.Target).Any(g => g.Count() > 1)) Warnings.Add(deviceName + ": mehrere Signale auf demselben Kanal – nur das letzte ist zu hören");
            return mux;
        }

        void StartWasapi(AudioSettings s, List<OutputRoute> outs, List<InputRoute> ins)
        {
            using (var en = new MMDeviceEnumerator())
            {
                foreach (var g in outs.GroupBy(o => o.Device))
                {
                    var dev = Find(en, g.Key, DataFlow.Render, g.First().DeviceName);
                    var mf = dev.AudioClient.MixFormat;
                    var mix = DeviceMix(g.ToList(), mf.SampleRate, mf.Channels, dev.FriendlyName);
                    var player = new WasapiOut(dev, AudioClientShareMode.Shared, true, s.BufferMs);
                    player.Init(mix, false);
                    player.Play();
                    parts.Add(player);
                }
                foreach (var g in ins.GroupBy(i => i.Device))
                {
                    var dev = Find(en, g.Key, DataFlow.Capture, g.First().DeviceName);
                    var cap = new WasapiCapture(dev, true, Math.Max(20, s.BufferMs / 2));
                    var wf = cap.WaveFormat;
                    var group = g.Select(r => new InputBranch(r, wf.SampleRate)).ToList();
                    branches.AddRange(group);
                    float[] block = new float[0];
                    cap.DataAvailable += (o, e) =>
                    {
                        var frames = e.BytesRecorded / wf.BlockAlign;
                        if (block.Length < frames * wf.Channels) block = new float[frames * wf.Channels];
                        if (!ToFloat(e.Buffer, e.BytesRecorded, wf, block)) return;
                        foreach (var b in group) b.Feed(block, frames, wf.Channels);
                    };
                    if (!(wf.Encoding == WaveFormatEncoding.IeeeFloat || wf.BitsPerSample == 16 || wf.Encoding == WaveFormatEncoding.Extensible))
                        Warnings.Add(dev.FriendlyName + ": Aufnahmeformat " + wf + " wird nicht unterstützt");
                    cap.StartRecording();
                    parts.Add(cap);
                }
            }
        }

        static MMDevice Find(MMDeviceEnumerator en, string id, DataFlow flow, string name)
        {
            // Ohne Gerät: das Windows-Standardgerät (folgt einem Wechsel in Windows beim nächsten Verbinden)
            if (string.IsNullOrEmpty(id) && string.IsNullOrEmpty(name))
            {
                try { return en.GetDefaultAudioEndpoint(flow, Role.Multimedia); }
                catch (Exception ex) when (!(ex is OutOfMemoryException)) { throw new InvalidOperationException(flow == DataFlow.Render ? "Kein Wiedergabegerät in Windows aktiv – Lautsprecher oder Kopfhörer anschließen" : "Kein Aufnahmegerät in Windows aktiv"); }
            }
            try { if (!string.IsNullOrEmpty(id)) return en.GetDevice(id); } catch (Exception ex) when (!(ex is OutOfMemoryException)) { }
            // Gerät neu eingesteckt (neue ID): über den Namen wiederfinden
            var byName = en.EnumerateAudioEndPoints(flow, DeviceState.Active).FirstOrDefault(d => d.FriendlyName == name);
            if (byName != null) return byName;
            throw new InvalidOperationException("Gerät nicht gefunden: " + (name.Length > 0 ? name : id) + " – angeschlossen und in Windows aktiviert?");
        }

        /// <summary>WASAPI-Aufnahme (Shared: meist 32-bit float; sonst 16/24/32-bit PCM) → float.</summary>
        static bool ToFloat(byte[] buf, int bytes, WaveFormat wf, float[] dst)
        {
            var sub = wf as WaveFormatExtensible;
            var isFloat = wf.Encoding == WaveFormatEncoding.IeeeFloat || (sub != null && sub.SubFormat == NAudio.Dmo.AudioMediaSubtypes.MEDIASUBTYPE_IEEE_FLOAT);
            if (isFloat && wf.BitsPerSample == 32) { System.Buffer.BlockCopy(buf, 0, dst, 0, bytes); return true; }
            var n = bytes / (wf.BitsPerSample / 8);
            switch (wf.BitsPerSample)
            {
                case 16: for (var i = 0; i < n; i++) dst[i] = BitConverter.ToInt16(buf, i * 2) / 32768f; return true;
                case 24: for (var i = 0; i < n; i++) dst[i] = ((buf[i * 3] << 8 | buf[i * 3 + 1] << 16 | buf[i * 3 + 2] << 24) >> 8) / 8388608f; return true;
                case 32: for (var i = 0; i < n; i++) dst[i] = BitConverter.ToInt32(buf, i * 4) / 2147483648f; return true;
                default: return false;
            }
        }

        void StartAsio(AudioSettings s, List<OutputRoute> outs, List<InputRoute> ins)
        {
            if (string.IsNullOrEmpty(s.AsioDriver)) throw new InvalidOperationException("Bitte einen ASIO-Treiber wählen");
            var asio = new AsioOut(s.AsioDriver);
            parts.Add(asio);
            var rate = asio.IsSampleRateSupported(AudioMath.ServerRate) ? AudioMath.ServerRate : 48000;
            var outCount = Math.Min(asio.DriverOutputChannelCount, Math.Max(2, AudioMath.ChannelsNeeded(outs)));
            var inCount = ins.Count == 0 ? 0 : Math.Min(asio.DriverInputChannelCount, ins.Max(i => i.Channel + (i.Stereo ? 2 : 1)));
            IWaveProvider play = outs.Count > 0 ? new SampleToWaveProvider(DeviceMix(outs, rate, outCount, s.AsioDriver)) : null;
            if (inCount > 0)
            {
                var group = ins.Select(r => new InputBranch(r, rate)).ToList();
                branches.AddRange(group);
                float[] block = new float[0];
                asio.AudioAvailable += (o, e) =>
                {
                    var need = e.SamplesPerBuffer * inCount;
                    if (block.Length < need) block = new float[need];
                    e.GetAsInterleavedSamples(block);
                    foreach (var b in group) b.Feed(block, e.SamplesPerBuffer, inCount);
                };
                asio.InputChannelOffset = 0;
                asio.InitRecordAndPlayback(play, inCount, rate);
            }
            else asio.Init(play);
            asio.ChannelOffset = 0;
            asio.Play();
        }

        // ---------- Eingang → Server ----------

        /// <summary>Alle Eingänge mischen (44,1 kHz Stereo) und im Takt der Uhr als PCM an den Server schicken.</summary>
        void StartUpload()
        {
            var mixer = new MixingSampleProvider(WaveFormat.CreateIeeeFloatWaveFormat(AudioMath.ServerRate, 2)) { ReadFully = true };
            foreach (var b in branches)
            {
                ISampleProvider p = b.Buffer.ToSampleProvider();
                if (b.Buffer.WaveFormat.SampleRate != AudioMath.ServerRate) p = new WdlResamplingSampleProvider(p, AudioMath.ServerRate);
                mixer.AddMixerInput(p);
            }
            var cts = new CancellationTokenSource();
            upload = cts;
            var client = api();
            var path = "/api/v1/stations/" + Uri.EscapeDataString(station()) + "/audio/input";
            new Thread(() =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try { PumpInput(client, path, mixer, cts.Token); }
                    catch (Exception ex) when (!(ex is OutOfMemoryException)) { lock (Warnings) Warnings.Add("Eingang → Server: " + ex.Message); }
                    if (!cts.IsCancellationRequested) cts.Token.WaitHandle.WaitOne(2000);
                }
            }) { IsBackground = true, Name = "AnMaChaCast.AudioInput", Priority = ThreadPriority.AboveNormal }.Start();
        }

        /// <summary>
        /// Rohe HTTP-Verbindung mit chunked Body (HttpClient im .NET Framework puffert Uploads ohne Länge komplett).
        /// </summary>
        static void PumpInput(ApiClient client, string path, ISampleProvider mixer, CancellationToken ct)
        {
            var origin = client.Origin;
            using (var tcp = new TcpClient())
            {
                tcp.NoDelay = true;
                tcp.Connect(origin.Host, origin.Port);
                Stream net = tcp.GetStream();
                if (origin.Scheme == "https")
                {
                    var tls = new SslStream(net, false);
                    tls.AuthenticateAsClient(origin.Host);
                    net = tls;
                }
                using (net)
                {
                    var head = "PUT " + path + " HTTP/1.1\r\nHost: " + origin.Authority + "\r\nAuthorization: Bearer " + client.Token +
                               "\r\nX-Audio-Format: " + AudioMath.ServerFormat + "\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\nUser-Agent: AnMaCha Cast\r\n\r\n";
                    var hb = Encoding.ASCII.GetBytes(head);
                    net.Write(hb, 0, hb.Length);
                    const int blockMs = 20;
                    var frames = AudioMath.ServerRate * blockMs / 1000;
                    var f = new float[frames * 2];
                    var pcm = new byte[frames * 4];
                    var clock = Stopwatch.StartNew();
                    long sent = 0;
                    while (!ct.IsCancellationRequested)
                    {
                        // im Takt der Uhr senden (Server erwartet Echtzeit; zu viel Vorlauf verwirft er)
                        var due = (long)(clock.Elapsed.TotalSeconds * AudioMath.ServerRate) - sent;
                        if (due < frames) { Thread.Sleep(5); continue; }
                        if (due > AudioMath.ServerRate) { sent += due - frames; }
                        mixer.Read(f, 0, f.Length);
                        AudioMath.FloatToS16(f, f.Length, pcm);
                        var size = Encoding.ASCII.GetBytes(pcm.Length.ToString("x") + "\r\n");
                        net.Write(size, 0, size.Length);
                        net.Write(pcm, 0, pcm.Length);
                        net.Write(new byte[] { 13, 10 }, 0, 2);
                        sent += frames;
                    }
                    var end = Encoding.ASCII.GetBytes("0\r\n\r\n");
                    try { net.Write(end, 0, end.Length); } catch (IOException) { }
                }
            }
        }
    }
}
