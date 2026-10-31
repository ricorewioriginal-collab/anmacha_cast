using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using AnMaChaCast.Logic;
using Xunit;

namespace AnMaChaCast.Tests
{
    sealed class FakeProtector : ISecretProtector
    {
        public string Protect(string plain) => "P:" + new string(plain.Reverse().ToArray());
        public string Unprotect(string stored) => stored.StartsWith("P:") ? new string(stored.Substring(2).Reverse().ToArray()) : throw new FormatException();
    }

    public class JsonTests
    {
        static JsonElement Parse(string s) { using (var d = JsonDocument.Parse(s)) return d.RootElement.Clone(); }

        [Fact]
        public void LiestFelderTolerant()
        {
            var e = Parse("{\"title\":\"Hit\",\"n\":5,\"x\":\"7\",\"on\":true,\"cfg\":{\"auto\":{\"enabled\":true}},\"tags\":[\"a\",2],\"days\":[0,2,\"x\"]}");
            Assert.Equal("Hit", J.Str(e, "title"));
            Assert.Equal("5", J.Str(e, "n"));
            Assert.Equal(7, J.Long(e, "x"));
            Assert.Equal(0, J.Long(e, "fehlt"));
            Assert.True(J.Bool(e, "cfg.auto.enabled"));
            Assert.False(J.Bool(e, "cfg.auto.nope"));
            Assert.Equal(new[] { "a", "2" }, J.Strings(e, "tags"));
            Assert.Equal(new[] { 0, 2 }, J.Ints(e, "days"));
            Assert.Empty(J.Arr(default(JsonElement)));
            Assert.Equal("", J.Str(default(JsonElement), "title"));
        }

        [Fact]
        public void FehlertextAusAntwort()
        {
            Assert.Equal("Kein Zugriff", J.ErrorText("{\"error\":\"forbidden\",\"message\":\"Kein Zugriff\"}"));
            Assert.Equal("forbidden", J.ErrorText("{\"error\":\"forbidden\"}"));
            Assert.Equal("<html>", J.ErrorText("<html>"));
            Assert.Equal("", J.ErrorText(""));
        }
    }

    public class FormatTests
    {
        [Fact]
        public void DauerUndGroesse()
        {
            Assert.Equal("3:05", Fmt.Dur(185_000));
            Assert.Equal("1:01:01", Fmt.Dur(3_661_000));
            Assert.Equal("–", Fmt.Dur(null));
            Assert.Equal("512 B", Fmt.Size(512));
            Assert.Equal("1,5 MB", Fmt.Size(1_572_864));
        }

        [Fact]
        public void Wochentage()
        {
            Assert.Equal("täglich", Fmt.Days(new int[0]));
            Assert.Equal("Mo,Mi", Fmt.Days(new[] { 2, 0, 2 }));
            Assert.Equal(new[] { 0, 4 }, Fmt.ParseDays("Mo, fr, xx"));
            Assert.True(Fmt.ValidTime("06:30"));
            Assert.False(Fmt.ValidTime("24:00"));
            Assert.False(Fmt.ValidTime("6:30"));
        }

        [Theory]
        [InlineData("radio.example.de", "https://radio.example.de")]
        [InlineData("https://Radio.Example.de/studio/?x=1", "https://radio.example.de")]
        [InlineData("192.168.1.20:4848", "http://192.168.1.20:4848")]
        [InlineData("localhost:4848/", "http://localhost:4848")]
        [InlineData("mein-nas", "http://mein-nas")]
        public void ServerAdresse(string input, string expected) => Assert.Equal(expected, Fmt.NormalizeBase(input));

        [Theory]
        [InlineData("")]
        [InlineData("ftp://x.de")]
        [InlineData("https://user:pw@x.de")]
        public void UngueltigeAdresse(string input) => Assert.Throws<ArgumentException>(() => Fmt.NormalizeBase(input));

        [Fact]
        public void Kopplungscode()
        {
            Assert.Equal("123456", Fmt.PairCode(" 123-456 "));
            Assert.Equal("", Fmt.PairCode("abc"));
            Assert.Equal("abcd…", Fmt.Clip("abcdefgh", 5));
        }

        [Fact]
        public void Zeitstempel()
        {
            Assert.Equal("03.10.2026 12:00", Fmt.Stamp(new DateTimeOffset(2026, 10, 3, 10, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(), TimeZoneInfo.CreateCustomTimeZone("t", TimeSpan.FromHours(2), "t", "t")));
            Assert.Equal("–", Fmt.Stamp(0));
        }
    }

    public class ServerStoreTests
    {
        [Fact]
        public void SpeichertTokenGeschuetztUndLaedtWieder()
        {
            var dir = Path.Combine(Path.GetTempPath(), "anmachacast-test-" + Guid.NewGuid().ToString("N"));
            var file = Path.Combine(dir, "servers.json");
            try
            {
                var store = new ServerStore(file, new FakeProtector());
                Assert.Equal(ServerStore.LocalId, store.Active.Id);
                var p = store.Upsert("Studio", "https://radio.example.de", "geheim-token");
                store.ActiveId = p.Id;
                store.Save();
                Assert.DoesNotContain("geheim-token", File.ReadAllText(file));

                var again = new ServerStore(file, new FakeProtector());
                Assert.Equal(2, again.All.Count);
                Assert.Equal("geheim-token", again.Active.Token);
                Assert.Equal("Studio", again.Active.Name);

                // gleiche Adresse: aktualisieren statt doppelt anlegen
                var q = again.Upsert("Neu", "https://RADIO.example.de", "neuer-token");
                Assert.Equal(p.Id, q.Id);
                Assert.Equal(2, again.All.Count);
                Assert.Equal("neuer-token", again.Find(p.Id).Token);

                again.Remove(p.Id);
                Assert.Equal(ServerStore.LocalId, again.ActiveId);
                Assert.Single(again.All);
            }
            finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
        }

        [Fact]
        public void DefekteDateiUndFremderSchluessel()
        {
            var dir = Path.Combine(Path.GetTempPath(), "anmachacast-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "servers.json");
            try
            {
                File.WriteAllText(file, "{kaputt");
                Assert.Single(new ServerStore(file, new FakeProtector()).All);

                File.WriteAllText(file, "{\"Active\":\"srv_1\",\"Servers\":[{\"Id\":\"srv_1\",\"Name\":\"X\",\"BaseUrl\":\"https://x.de\",\"Token\":\"fremd\"}]}");
                var s = new ServerStore(file, new FakeProtector());
                Assert.Equal("", s.Find("srv_1").Token); // nicht entschlüsselbar: neu koppeln, nichts Falsches verwenden
            }
            finally { Directory.Delete(dir, true); }
        }
    }

    public class ConfigTreeTests
    {
        static JsonElement Parse(string s) { using (var d = JsonDocument.Parse(s)) return d.RootElement.Clone(); }
        const string Doc = "{\"volume\":0.8,\"enabled\":true,\"name\":\"Haupt\",\"fades\":{\"in\":{\"ms\":3000,\"curve\":\"log\"},\"out\":{\"ms\":2500}},\"days\":[1,2],\"empty\":{}}";

        [Fact]
        public void ListetEinzelneWerte()
        {
            var e = ConfigTree.Flatten(Parse(Doc));
            Assert.Equal(new[] { "volume", "enabled", "name", "fades.in.ms", "fades.in.curve", "fades.out.ms", "days", "empty" }, e.Select(x => x.Path).ToArray());
            Assert.Equal("an", e.First(x => x.Path == "enabled").Display);
            Assert.Equal("[1,2]", e.First(x => x.Path == "days").Display);
            Assert.Equal(JsonValueKind.Array, e.First(x => x.Path == "days").Kind);
        }

        [Fact]
        public void AendertGenauEinenWertUndLiefertDenObersten()
        {
            var fades = ConfigTree.Apply(Doc, new[] { "fades", "in", "ms" }, JsonValueKind.Number, "4500");
            Assert.Equal("{\"in\":{\"ms\":4500,\"curve\":\"log\"},\"out\":{\"ms\":2500}}", fades);
            Assert.Equal("0.5", ConfigTree.Apply(Doc, new[] { "volume" }, JsonValueKind.Number, "0,5"));
            Assert.Equal("false", ConfigTree.Apply(Doc, new[] { "enabled" }, JsonValueKind.True, "aus"));
            Assert.Equal("\"Neu\"", ConfigTree.Apply(Doc, new[] { "name" }, JsonValueKind.String, "Neu"));
            Assert.Equal("[3,4,5]", ConfigTree.Apply(Doc, new[] { "days" }, JsonValueKind.Array, "[3,4,5]"));
        }

        [Fact]
        public void UngueltigeEingabenWerdenAbgelehnt()
        {
            Assert.Throws<FormatException>(() => ConfigTree.Apply(Doc, new[] { "volume" }, JsonValueKind.Number, "laut"));
            Assert.Throws<FormatException>(() => ConfigTree.Apply(Doc, new[] { "enabled" }, JsonValueKind.True, "vielleicht"));
            Assert.Throws<FormatException>(() => ConfigTree.Apply(Doc, new[] { "days" }, JsonValueKind.Array, "{\"a\":1}"));
            Assert.ThrowsAny<JsonException>(() => ConfigTree.Apply(Doc, new[] { "days" }, JsonValueKind.Array, "[1,"));
            Assert.Throws<FormatException>(() => ConfigTree.Apply(Doc, new[] { "fades", "nope", "ms" }, JsonValueKind.Number, "1"));
        }

    }

    public class PairingLinkTests
    {
        [Fact]
        public void BautDenLinkWieImStudio()
        {
            Assert.Equal("http://192.168.1.20:8750/#pair=123456", PairingLink.Build("http://192.168.1.20:8750/", "123456"));
            Assert.Equal("https://radio.example/#pair=000042", PairingLink.Build(" https://radio.example ", "000042"));
        }

        [Fact]
        public void LehntUngueltigesAb()
        {
            Assert.Null(PairingLink.Build(null, "123456"));
            Assert.Null(PairingLink.Build("http://h", "12345"));
            Assert.Null(PairingLink.Build("http://h", "12345a"));
        }

        [Fact]
        public void BehaeltServerReihenfolgeUndStelltLocalhostANsEnde()
        {
            Assert.Equal(new[] { "http://192.168.1.20:8750", "http://172.28.16.1:8750", "http://localhost:8750" },
                PairingLink.Ranked(new[] { "http://localhost:8750", "http://192.168.1.20:8750", "http://172.28.16.1:8750" }));
            Assert.Empty(PairingLink.Ranked(new string[0]));
            Assert.Empty(PairingLink.Ranked(null));
        }
    }

    public class ToolReleaseTests
    {
        static readonly string[] Assets =
        {
            "photocraft-0.11.1-windows-x64-portable.zip", "photocraft-0.11.1-windows-x64.msi", "photocraft-0.11.1-windows-arm64-portable.zip",
            "photocraft-0.11.1-windows-x86-portable.zip", "photocraft-web-0.11.1.zip", "SHA256SUMS.txt",
        };

        [Fact]
        public void WaehltPortableZipPassendZurArchitektur()
        {
            Assert.Equal("photocraft-0.11.1-windows-x64-portable.zip", ToolRelease.PickPortableZip("photocraft", Assets, "x64"));
            Assert.Equal("photocraft-0.11.1-windows-arm64-portable.zip", ToolRelease.PickPortableZip("photocraft", Assets, "arm64"));
            Assert.Null(ToolRelease.PickPortableZip("filmcraft", Assets, "x64"));
            Assert.Equal(new[] { "arm64", "x64" }, ToolRelease.ArchOrder("Arm64"));
            Assert.Equal(new[] { "x64" }, ToolRelease.ArchOrder("X64"));
        }

        [Fact]
        public void LiestPruefsummeAusSha256Sums()
        {
            var sums = "f954c8096eeb5ab7ab20cd73445420097a4afde46f3d79547b3c9fe4f03d735f  photocraft-web-0.11.1.zip\n" +
                       "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA *photocraft-0.11.1-windows-x64-portable.zip\r\n";
            Assert.Equal("f954c8096eeb5ab7ab20cd73445420097a4afde46f3d79547b3c9fe4f03d735f", ToolRelease.Checksum(sums, "photocraft-web-0.11.1.zip"));
            Assert.Equal(new string('a', 64), ToolRelease.Checksum(sums, "photocraft-0.11.1-windows-x64-portable.zip"));
            Assert.Null(ToolRelease.Checksum(sums, "andere.zip"));
            Assert.Null(ToolRelease.Checksum("kaputt", "photocraft-web-0.11.1.zip"));
        }

        [Fact]
        public void FindetDasStartprogramm()
        {
            Assert.Equal("photocraft-0.11.1/photocraft.exe", ToolRelease.PickExe("photocraft", new[] { "photocraft-0.11.1/bin/helper.exe", "photocraft-0.11.1/photocraft.exe" }));
            Assert.Equal("app/start.exe", ToolRelease.PickExe("filmcraft", new[] { "app/uninstall.exe", "app/start.exe", "app/tools/x.exe" }));
            Assert.Null(ToolRelease.PickExe("x", new string[0]));
            Assert.Equal("v0.11.1", ToolRelease.SafeVersion("v0.11.1"));
            Assert.Equal("unbekannt", ToolRelease.SafeVersion("../"));
        }
    }
}
