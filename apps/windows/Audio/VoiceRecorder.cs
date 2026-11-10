// Voicetrack-Aufnahme im Live-Studio: Mikrofon (WASAPI, geteilter Modus – läuft neben der Audio-Engine) in eine
// WAV-Datei, mit Pegel für die Anzeige und Vorhören vor dem Einreihen. Die Datei liegt im Temp-Ordner und wird
// nach dem Einreihen bzw. Verwerfen gelöscht.
using System;
using System.IO;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AnMaChaCast.Audio
{
    sealed class VoiceRecorder : IDisposable
    {
        WasapiCapture capture;
        WaveFileWriter writer;
        WasapiOut player;
        WaveFileReader reader;
        DateTime started;

        public string File { get; private set; }
        public bool Recording => capture != null;
        public bool Playing => player != null && player.PlaybackState == PlaybackState.Playing;
        public TimeSpan Length { get; private set; }
        public TimeSpan Elapsed => Recording ? DateTime.UtcNow - started : Length;
        /// <summary>Spitzenpegel 0…1 seit der letzten Abfrage.</summary>
        public float Peak { get { var p = peak; peak = 0; return p; } }
        volatile float peak;

        /// <summary>Aufnahme starten. deviceId leer = Standard-Aufnahmegerät von Windows.</summary>
        public void Start(string deviceId)
        {
            Discard();
            MMDevice dev;
            using (var en = new MMDeviceEnumerator())
            {
                dev = null;
                if (!string.IsNullOrEmpty(deviceId)) try { dev = en.GetDevice(deviceId); } catch (Exception) { dev = null; }
                if (dev == null) dev = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
            }
            File = Path.Combine(Path.GetTempPath(), "anmachacast-voicetrack-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".wav");
            var cap = new WasapiCapture(dev, true, 50);
            var wf = cap.WaveFormat;
            writer = new WaveFileWriter(File, wf);
            cap.DataAvailable += (s, e) =>
            {
                writer?.Write(e.Buffer, 0, e.BytesRecorded);
                peak = Math.Max(peak, PeakOf(e.Buffer, e.BytesRecorded, wf));
            };
            cap.RecordingStopped += (s, e) => { writer?.Dispose(); writer = null; };
            started = DateTime.UtcNow;
            capture = cap;
            cap.StartRecording();
        }

        /// <summary>Aufnahme beenden; die WAV-Datei ist danach vollständig.</summary>
        public void Stop()
        {
            if (capture == null) return;
            Length = DateTime.UtcNow - started;
            var cap = capture;
            capture = null;
            cap.StopRecording();
            cap.Dispose();
            writer?.Dispose(); // falls RecordingStopped noch nicht kam: Kopf mit der Länge schreiben
            writer = null;
        }

        /// <summary>Aufnahme anhören (über das Standard-Wiedergabegerät) bzw. wieder anhalten.</summary>
        public void TogglePlay()
        {
            if (Playing) { StopPlay(); return; }
            if (File == null || !System.IO.File.Exists(File) || Recording) return;
            StopPlay();
            reader = new WaveFileReader(File);
            player = new WasapiOut(AudioClientShareMode.Shared, 100);
            player.Init(reader);
            player.PlaybackStopped += (s, e) => StopPlay();
            player.Play();
        }

        void StopPlay()
        {
            var p = player; player = null;
            try { p?.Stop(); } catch (InvalidOperationException) { }
            p?.Dispose();
            reader?.Dispose(); reader = null;
        }

        /// <summary>Aufnahme verwerfen (Datei löschen).</summary>
        public void Discard()
        {
            Stop();
            StopPlay();
            if (File != null) try { System.IO.File.Delete(File); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            File = null;
            Length = TimeSpan.Zero;
        }

        static float PeakOf(byte[] buf, int bytes, WaveFormat wf)
        {
            float max = 0;
            if (wf.Encoding == WaveFormatEncoding.IeeeFloat || (wf.Encoding == WaveFormatEncoding.Extensible && wf.BitsPerSample == 32))
                for (var i = 0; i + 3 < bytes; i += 4) max = Math.Max(max, Math.Abs(BitConverter.ToSingle(buf, i)));
            else if (wf.BitsPerSample == 16)
                for (var i = 0; i + 1 < bytes; i += 2) max = Math.Max(max, Math.Abs(BitConverter.ToInt16(buf, i) / 32768f));
            else if (wf.BitsPerSample == 24)
                for (var i = 0; i + 2 < bytes; i += 3) max = Math.Max(max, Math.Abs(((buf[i] << 8 | buf[i + 1] << 16 | buf[i + 2] << 24) >> 8) / 8388608f));
            return Math.Min(1, max);
        }

        public void Dispose() => Discard();
    }
}
