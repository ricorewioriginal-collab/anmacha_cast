using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using AnMaChaCast.Logic;
using Xunit;

namespace AnMaChaCast.Tests
{
    public class AudioRoutingTests
    {
        [Fact]
        public void DecksAufMischpultKanaele()
        {
            // Deck A → 1/2, Deck B → 3/4, Cardwall mono → 5
            var routes = new List<OutputRoute>
            {
                new OutputRoute { Tap = "A", Channel = 0 },
                new OutputRoute { Tap = "B", Channel = 2 },
                new OutputRoute { Tap = "carts", Channel = 4, Mono = true },
            };
            Assert.Equal(5, AudioMath.ChannelsNeeded(routes));
            var map = AudioMath.ChannelMap(routes, 8);
            Assert.Equal(new[] { (0, 0), (1, 1), (2, 2), (3, 3), (4, 4) }, map);
            // Gerät mit nur 4 Kanälen: Cardwall passt nicht mehr
            Assert.Equal(4, AudioMath.ChannelMap(routes, 4).Count);
        }

        [Fact]
        public void PcmUmrechnungBegrenzt()
        {
            var bytes = new byte[8];
            AudioMath.FloatToS16(new[] { 0f, 1.5f, -2f, 0.5f }, 4, bytes);
            var back = new float[4];
            Assert.Equal(4, AudioMath.S16ToFloat(bytes, 0, 8, back));
            Assert.Equal(0f, back[0]);
            Assert.True(back[1] > 0.999f, "positiv begrenzt statt Überlauf");
            Assert.Equal(-1f, back[2]);
            Assert.InRange(back[3], 0.49f, 0.51f);
        }

        [Fact]
        public void MonoMikrofonMitPanoramaUndGain()
        {
            // 4-Kanal-Interface, Mikrofon an Kanal 3 (Index 2), +6 dB, Mitte
            var block = new float[] { 0, 0, 0.25f, 0.9f, 0, 0, -0.25f, 0.9f };
            var outp = new float[4];
            var mic = new InputRoute { Channel = 2, GainDb = 6, Pan = 0 };
            Assert.Equal(2, AudioMath.ExtractStereo(block, 2, 4, mic, outp));
            var g = Math.Pow(10, 6 / 20.0) * Math.Cos(Math.PI / 4);
            Assert.InRange(outp[0], 0.25 * g - 1e-4, 0.25 * g + 1e-4);
            Assert.Equal(outp[0], outp[1], 4);
            Assert.InRange(outp[2], -0.25 * g - 1e-4, -0.25 * g + 1e-4);
            // ganz links: rechts still
            var left = new InputRoute { Channel = 2, Pan = -1 };
            AudioMath.ExtractStereo(block, 2, 4, left, outp);
            Assert.True(Math.Abs(outp[1]) < 1e-6);
            // Stereo-Paar 3/4 (Mischpult-Summe)
            var sum = new InputRoute { Channel = 2, Stereo = true };
            AudioMath.ExtractStereo(block, 2, 4, sum, outp);
            Assert.Equal(new[] { 0.25f, 0.9f, -0.25f, 0.9f }, outp);
        }

        [Fact]
        public void LatenzWirdBegrenzt()
        {
            var bps = 44100 * 4;
            Assert.Equal(0, AudioMath.BytesToDrop(bps / 10, bps, 4));
            var drop = AudioMath.BytesToDrop(bps, bps, 4); // 1 s im Puffer → auf 150 ms
            Assert.Equal(0, drop % 4);
            Assert.InRange(bps - drop, bps * 0.149, bps * 0.151);
        }

        [Fact]
        public void EinstellungenSpeichernUndBereinigen()
        {
            var dir = Path.Combine(Path.GetTempPath(), "cast-audio-" + Guid.NewGuid().ToString("N"));
            var file = Path.Combine(dir, "audio.json");
            try
            {
                var s = new AudioSettings { Driver = "kaputt", BufferMs = 5 };
                s.Outputs.Add(new OutputRoute { Tap = "gibtsnicht", Channel = 99, VolumeDb = 40 });
                s.Inputs.Add(new InputRoute { Name = "Mischpult", Stereo = true, GainDb = -100, Pan = 3 });
                s.Save(file);
                var l = AudioSettings.Load(file);
                Assert.Equal("wasapi", l.Driver);
                Assert.Equal(10, l.BufferMs);
                Assert.Equal("program", l.Outputs[0].Tap);
                Assert.Equal(63, l.Outputs[0].Channel);
                Assert.Equal(12, l.Outputs[0].VolumeDb);
                Assert.Equal(-30, l.Inputs[0].GainDb);
                Assert.Equal(1, l.Inputs[0].Pan);
                Assert.True(l.Inputs[0].Stereo);
                // kaputte Datei → Standard statt Absturz
                File.WriteAllText(file, "{kaputt");
                Assert.Empty(AudioSettings.Load(file).Outputs);
            }
            finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
        }
    }
}
