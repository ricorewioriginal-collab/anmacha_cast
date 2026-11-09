// Soundkarten-Routing der Windows-App (ohne NAudio/WPF, damit unter .NET 8 testbar): Einstellungen, Kanalzuordnung,
// Umrechnung PCM ⇄ float und das Mischen der Eingänge (Mikrofone, Line-In, Mischpult) zu einem Stereo-Signal.
// Der Server liefert/erwartet s16le, 44,1 kHz, Stereo (src/core/pcm.ts); die Soundkarte läuft in ihrem eigenen Takt.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace AnMaChaCast.Logic
{
    /// <summary>Signale, die der Server einzeln abgreifen lässt (GET /audio/taps/{id}).</summary>
    static class AudioTaps
    {
        public static readonly (string Id, string Label)[] All =
        {
            ("program", "Programm (Summe)"), ("A", "Deck A"), ("B", "Deck B"), ("C", "Deck C"), ("D", "Deck D"), ("carts", "Cardwall / Jingles"),
        };

        public static string Label(string id) => All.FirstOrDefault(t => t.Id == id).Label ?? id;
    }

    /// <summary>Ein Signal auf ein Gerät und ab einem Kanal (Stereo belegt Kanal und Kanal+1, Mono nur den einen).</summary>
    sealed class OutputRoute
    {
        public string Tap { get; set; } = "program";
        /// <summary>WASAPI: Geräte-ID. ASIO: leer (es gilt der gewählte ASIO-Treiber).</summary>
        public string Device { get; set; } = "";
        public string DeviceName { get; set; } = "";
        /// <summary>Erster Ausgangskanal, 0-basiert (0 = Kanal 1)</summary>
        public int Channel { get; set; }
        public bool Mono { get; set; }
        public double VolumeDb { get; set; }
        public bool Enabled { get; set; } = true;
    }

    /// <summary>Ein Eingang: Mikrofon, Line-In/Klinke, Bluetooth-Headset oder die Summe eines Mischpults.</summary>
    sealed class InputRoute
    {
        public string Name { get; set; } = "Mikrofon";
        public string Device { get; set; } = "";
        public string DeviceName { get; set; } = "";
        /// <summary>Eingangskanal, 0-basiert. Mono-Mikrofon: dieser Kanal auf beide Seiten; Stereo: Kanal und Kanal+1.</summary>
        public int Channel { get; set; }
        public bool Stereo { get; set; }
        public double GainDb { get; set; }
        /// <summary>Links/Rechts-Verteilung für Mono-Eingänge: −1 … +1</summary>
        public double Pan { get; set; }
        public bool Enabled { get; set; } = true;
    }

    sealed class AudioSettings
    {
        /// <summary>"wasapi" (alle Windows-Geräte) oder "asio" (ein ASIO-Treiber für alle Ein- und Ausgänge)</summary>
        public string Driver { get; set; } = "wasapi";
        public string AsioDriver { get; set; } = "";
        /// <summary>Puffer der Soundkarte in ms (WASAPI-Latenz)</summary>
        public int BufferMs { get; set; } = 60;
        /// <summary>Beim Programmstart automatisch verbinden (Mithören). Neu: an – wer AnMaCha Cast startet, will den Sender hören.</summary>
        public bool AutoStart { get; set; } = true;
        public List<OutputRoute> Outputs { get; set; } = new List<OutputRoute>();
        public List<InputRoute> Inputs { get; set; } = new List<InputRoute>();

        static readonly JsonSerializerOptions Opts = new JsonSerializerOptions { WriteIndented = true };

        public static AudioSettings Load(string file)
        {
            try
            {
                if (File.Exists(file)) return Sanitize(JsonSerializer.Deserialize<AudioSettings>(File.ReadAllText(file)) ?? new AudioSettings());
            }
            catch (Exception ex) when (ex is IOException || ex is JsonException || ex is UnauthorizedAccessException) { }
            return new AudioSettings();
        }

        public void Save(string file)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file, JsonSerializer.Serialize(Sanitize(this), Opts));
        }

        /// <summary>
        /// Treiber, der wirklich genutzt wird: ASIO nur, wenn es gewählt ist und ein ASIO-Treiber installiert ist.
        /// Ohne ASIO-Treiber (normale Soundkarte, z. B. Realtek) gilt WASAPI – sonst bliebe es einfach still.
        /// </summary>
        public static string EffectiveDriver(AudioSettings s, bool asioInstalled) => s.Driver == "asio" && asioInstalled ? "asio" : "wasapi";

        /// <summary>
        /// Ausgänge, die gestartet werden. Ohne eigene Einrichtung (WASAPI) läuft das Programm auf dem Windows-Standardgerät
        /// (Gerät leer = Standard-Wiedergabegerät), damit man ohne Einstellungen etwas hört.
        /// </summary>
        public static List<OutputRoute> EffectiveOutputs(AudioSettings s, string driver)
        {
            var on = s.Outputs.Where(o => o.Enabled).ToList();
            if (driver == "wasapi")
            {
                // ASIO-Belegung (ohne Gerät) gilt unter WASAPI nicht – dann ebenfalls das Standardgerät
                on = on.Where(o => o.Device.Length > 0 || o.DeviceName.Length > 0).ToList();
                if (on.Count == 0) on.Add(new OutputRoute { Tap = "program" });
            }
            return on;
        }

        /// <summary>Eingänge, die gestartet werden (unter WASAPI nur solche mit Gerät).</summary>
        public static List<InputRoute> EffectiveInputs(AudioSettings s, string driver) =>
            s.Inputs.Where(i => i.Enabled && (driver == "asio" || i.Device.Length > 0 || i.DeviceName.Length > 0)).ToList();

        /// <summary>Werte begrenzen (handbearbeitete Datei, alte Versionen).</summary>
        public static AudioSettings Sanitize(AudioSettings s)
        {
            s.Driver = s.Driver == "asio" ? "asio" : "wasapi";
            s.AsioDriver ??= "";
            s.BufferMs = Math.Max(10, Math.Min(500, s.BufferMs));
            s.Outputs ??= new List<OutputRoute>();
            s.Inputs ??= new List<InputRoute>();
            foreach (var o in s.Outputs)
            {
                if (!AudioTaps.All.Any(t => t.Id == o.Tap)) o.Tap = "program";
                o.Channel = Math.Max(0, Math.Min(63, o.Channel));
                o.VolumeDb = Math.Max(-60, Math.Min(12, o.VolumeDb));
                o.Device ??= ""; o.DeviceName ??= "";
            }
            foreach (var i in s.Inputs)
            {
                i.Channel = Math.Max(0, Math.Min(63, i.Channel));
                i.GainDb = Math.Max(-30, Math.Min(30, i.GainDb));
                i.Pan = Math.Max(-1, Math.Min(1, i.Pan));
                i.Device ??= ""; i.DeviceName ??= ""; i.Name ??= "Eingang";
            }
            return s;
        }
    }

    static class AudioMath
    {
        public const int ServerRate = 44100;
        public const int ServerChannels = 2;
        public const string ServerFormat = "s16le;rate=44100;channels=2";

        public static float DbToGain(double db) => db <= -60 ? 0f : (float)Math.Pow(10, db / 20);

        /// <summary>Wie viele Kanäle ein Gerät mindestens braucht, damit alle Routen darauf passen.</summary>
        public static int ChannelsNeeded(IEnumerable<OutputRoute> routes) =>
            routes.Where(r => r.Enabled).Select(r => r.Channel + (r.Mono ? 1 : 2)).DefaultIfEmpty(2).Max();

        /// <summary>
        /// Zuordnung Quelle → Gerätekanal für einen Multiplexer: Jede Route bringt zwei Quellkanäle (L, R) mit, in der
        /// Reihenfolge der Routen. Mono summiert L+R auf einen Kanal und wird deshalb über eine eigene Mono-Quelle geführt
        /// (ein Quellkanal). Liefert (Quellkanal, Gerätekanal) für alle Kanäle, die auf das Gerät passen.
        /// </summary>
        public static List<(int Source, int Target)> ChannelMap(IList<OutputRoute> routes, int deviceChannels)
        {
            var map = new List<(int, int)>();
            var src = 0;
            foreach (var r in routes)
            {
                var width = r.Mono ? 1 : 2;
                for (var k = 0; k < width; k++)
                {
                    var target = r.Channel + k;
                    if (target < deviceChannels) map.Add((src + k, target));
                }
                src += width;
            }
            return map;
        }

        /// <summary>s16le-Bytes → float (−1…1).</summary>
        public static int S16ToFloat(byte[] src, int offset, int count, float[] dst)
        {
            var n = count / 2;
            for (var i = 0; i < n; i++) dst[i] = (short)(src[offset + 2 * i] | (src[offset + 2 * i + 1] << 8)) / 32768f;
            return n;
        }

        /// <summary>float → s16le mit Begrenzung (kein Überlauf-Knacken).</summary>
        public static void FloatToS16(float[] src, int count, byte[] dst)
        {
            for (var i = 0; i < count; i++)
            {
                var v = (int)Math.Round(src[i] * 32767f);
                if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
                dst[2 * i] = (byte)v;
                dst[2 * i + 1] = (byte)(v >> 8);
            }
        }

        /// <summary>
        /// Einen Eingang aus einem Mehrkanal-Block (interleaved float, Gerätekanäle) als Stereo herauslösen: Mono-Kanal
        /// mit Panorama (gleiche Lautheit links/rechts bei Pan 0) oder Kanalpaar, jeweils mit Gain. Liefert Frames.
        /// </summary>
        public static int ExtractStereo(float[] block, int frames, int deviceChannels, InputRoute input, float[] stereoOut)
        {
            var gain = DbToGain(input.GainDb);
            var c = Math.Min(input.Channel, deviceChannels - 1);
            if (c < 0) return 0;
            var stereo = input.Stereo && c + 1 < deviceChannels;
            // Constant-Power-Panorama: bei Pan 0 je −3 dB, damit eine Stimme in der Mitte so laut wirkt wie ganz links
            var angle = (input.Pan + 1) * Math.PI / 4;
            var gl = stereo ? gain : gain * (float)Math.Cos(angle);
            var gr = stereo ? gain : gain * (float)Math.Sin(angle);
            for (var f = 0; f < frames; f++)
            {
                var b = f * deviceChannels;
                stereoOut[2 * f] = block[b + c] * gl;
                stereoOut[2 * f + 1] = block[b + (stereo ? c + 1 : c)] * gr;
            }
            return frames;
        }

        /// <summary>Spitzenpegel in dBFS (für die Pegelanzeige der Eingänge).</summary>
        public static double PeakDb(float[] samples, int count)
        {
            var p = 0f;
            for (var i = 0; i < count; i++) { var a = Math.Abs(samples[i]); if (a > p) p = a; }
            return p <= 0 ? -90 : Math.Max(-90, 20 * Math.Log10(p));
        }

        /// <summary>
        /// Latenzgrenze für Ausgänge: liegt mehr als maxMs im Puffer (Takt von Server und Soundkarte driften), wird auf
        /// targetMs zurückgeschnitten. Liefert die zu verwerfenden Bytes (ganze Frames).
        /// </summary>
        public static int BytesToDrop(int bufferedBytes, int bytesPerSecond, int frameBytes, int maxMs = 400, int targetMs = 150)
        {
            var max = (long)bytesPerSecond * maxMs / 1000;
            if (bufferedBytes <= max) return 0;
            var keep = (long)bytesPerSecond * targetMs / 1000;
            var drop = (int)(bufferedBytes - keep);
            return drop - drop % frameBytes;
        }
    }
}
