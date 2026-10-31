// Cast Tools: originale Open-Source-Anwendungen von ArtCraft (Apache-2.0) unter eigenem Namen – Cast Sound, Photo, Film, Vector,
// Word und Effect. „Am PC öffnen“ lädt beim ersten Mal die offizielle portable Desktop-Fassung aus dem GitHub-Release direkt auf
// diesen PC (geprüft gegen SHA256SUMS.txt), entpackt sie nach %LOCALAPPDATA%\AnMaChaCast\tools und startet sie. Nichts wird
// mitgeliefert oder verändert. „Im Browser“ öffnet die Web-Fassung, die der AnMaCha-Cast-Server bereitstellt.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class ToolsPage : View
    {
        static readonly string ToolsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast", "tools");
        static readonly HttpClient Http = MakeHttp();
        static readonly Dictionary<string, string> Icons = new Dictionary<string, string>
        {
            ["cast-sound"] = "\uE8D6", ["cast-photo"] = "\uE91B", ["cast-film"] = "\uE714", ["cast-vector"] = "\uE70F", ["cast-word"] = "\uE8A5", ["cast-effect"] = "\uE945",
        };

        readonly WrapPanel grid = new WrapPanel();
        readonly HashSet<string> busy = new HashSet<string>();
        List<JsonElement> tools = new List<JsonElement>();

        public override string Title => "Cast Tools";

        static HttpClient MakeHttp()
        {
            var h = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            h.DefaultRequestHeaders.UserAgent.ParseAdd("AnMaCha-Cast");
            return h;
        }

        public ToolsPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Children.Add(Kit.Card("Cast Tools", Kit.Hint(
                "Werkzeuge für Audio, Bilder, Video, Logos, Texte und bewegte Grafiken – die originalen Open-Source-Anwendungen. " +
                "„Am PC öffnen“ lädt sie beim ersten Mal aus dem offiziellen Release (Prüfsumme geprüft) und startet sie als eigenes Programm. " +
                "Fertige Dateien danach in AnMaCha Cast hochladen, z. B. unter Mediathek.")));
            var scroll = Kit.Scroll(grid);
            SetRow(scroll, 1);
            Children.Add(scroll);
        }

        public override async Task Show()
        {
            if (!C.Connected) return;
            await C.Run(async () => { tools = J.Arr(await C.Api.GetJ("/tools")).ToList(); Render(); }, "Cast Tools");
        }

        static string Dir(string id) => Path.Combine(ToolsDir, id);

        static (string Version, string Exe)? Local(string id)
        {
            try
            {
                var j = JsonDocument.Parse(File.ReadAllText(Path.Combine(Dir(id), "installed.json"))).RootElement;
                var exe = Path.Combine(Dir(id), J.Str(j, "exe"));
                return File.Exists(exe) ? (J.Str(j, "version"), exe) : ((string, string)?)null;
            }
            catch (Exception ex) when (ex is IOException || ex is JsonException || ex is UnauthorizedAccessException || ex is ArgumentException) { return null; }
        }

        void Render()
        {
            grid.Children.Clear();
            foreach (var t in tools)
            {
                var id = J.Str(t, "id");
                var local = Local(id);
                var web = J.Bool(t, "web.installed");
                var running = busy.Contains(id);
                var head = new DockPanel { LastChildFill = true };
                var icon = new Border
                {
                    Width = 40, Height = 40, CornerRadius = new CornerRadius(10), Margin = new Thickness(0, 0, 10, 0),
                    Background = Theme.Linear(135, (Theme.C("#4038BDF8"), 0), (Theme.C("#40818CF8"), 1)),
                    Child = Kit.Icon(Icons.TryGetValue(id, out var g) ? g : "\uE90F", 18),
                };
                ((TextBlock)icon.Child).HorizontalAlignment = HorizontalAlignment.Center;
                DockPanel.SetDock(icon, Dock.Left);
                head.Children.Add(icon);
                head.Children.Add(Kit.V(Kit.Text(J.Str(t, "name"), 15, true),
                    Kit.Text(local.HasValue ? "am PC · " + local.Value.Version : "noch nicht auf diesem PC", 11, false, Kit.Muted)));
                var buttons = Kit.Wrap(
                    Kit.Btn(running ? "Lädt …" : local.HasValue ? "Öffnen" : "Am PC öffnen", () => OpenNative(t), local.HasValue ? "Programm starten" : "Beim ersten Mal aus dem offiziellen Release laden", true),
                    Kit.Btn("Im Browser", () => OpenWeb(t), web ? "Web-Fassung vom AnMaCha-Cast-Server" : "Web-Fassung (lädt der Server beim ersten Mal)"));
                if (local.HasValue)
                {
                    buttons.Children.Add(Kit.Btn("Aktualisieren", () => C.Run(() => Download(t, true), J.Str(t, "name")), "Neueste Fassung laden"));
                    buttons.Children.Add(Kit.Btn("Entfernen", () => Remove(t)));
                }
                foreach (var b in buttons.Children.OfType<Button>()) b.IsEnabled = !running;
                var license = Kit.Text("Basiert auf " + J.Str(t, "upstream") + " · " + J.Str(t, "license"), 11, false, Kit.Muted);
                var body = Kit.V(head, Kit.Text(J.Str(t, "purpose"), 12, false, Kit.Fg, true), buttons, license);
                body.Children[1].SetValue(MarginProperty, new Thickness(0, 8, 0, 6));
                var card = Kit.Panel(body);
                card.Width = 330;
                card.Margin = new Thickness(0, 0, 10, 10);
                grid.Children.Add(card);
            }
        }

        Task OpenNative(JsonElement t) => C.Run(async () =>
        {
            var id = J.Str(t, "id");
            var local = Local(id);
            if (!local.HasValue) { await Download(t, false); local = Local(id); }
            if (!local.HasValue) return;
            Process.Start(new ProcessStartInfo(local.Value.Exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(local.Value.Exe) });
            C.Ok(J.Str(t, "name") + " gestartet");
        }, J.Str(t, "name"));

        Task OpenWeb(JsonElement t) => C.Run(async () =>
        {
            var id = J.Str(t, "id");
            if (!J.Bool(t, "web.installed"))
            {
                C.Status(J.Str(t, "name") + ": Der Server lädt die Web-Fassung …", false);
                await C.Api.PostJ("/tools/" + Uri.EscapeDataString(id) + "/install", null, 600);
                await Show();
            }
            var url = C.Api.Origin.GetLeftPart(UriPartial.Authority) + "/tools/" + Uri.EscapeDataString(id) + "/";
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }, J.Str(t, "name"));

        /// <summary>Neueste portable Desktop-Fassung aus dem offiziellen Release laden, Prüfsumme prüfen, entpacken.</summary>
        async Task Download(JsonElement t, bool update)
        {
            var id = J.Str(t, "id");
            var name = J.Str(t, "name");
            var repo = J.Str(t, "repo");
            var repoName = repo.Split('/').Last();
            busy.Add(id);
            Render();
            var tmpZip = Path.Combine(Path.GetTempPath(), "anmachacast-" + id + "-" + Guid.NewGuid().ToString("N") + ".zip");
            var tmpDir = Path.Combine(ToolsDir, "." + id + "-neu");
            try
            {
                C.Status(name + ": Suche das offizielle Release …", false);
                var rel = await GetJson("https://api.github.com/repos/" + repo + "/releases/latest", name);
                var assets = J.Arr(rel, "assets").ToList();
                var names = assets.Select(a => J.Str(a, "name")).ToList();
                var arch = RuntimeInformation.OSArchitecture.ToString();
                var zipName = ToolRelease.ArchOrder(arch).Select(a => ToolRelease.PickPortableZip(repoName, names, a)).FirstOrDefault(n => n != null);
                if (zipName == null) throw new ApiException(0, name + ": Im aktuellen Release gibt es keine Windows-Fassung für diesen PC");
                if (!names.Contains("SHA256SUMS.txt")) throw new ApiException(0, name + ": Release ohne Prüfsummen – aus Sicherheitsgründen nicht geladen");
                var sums = await Http.GetStringAsync(J.Str(assets.First(a => J.Str(a, "name") == "SHA256SUMS.txt"), "browser_download_url"));
                var expected = ToolRelease.Checksum(sums, zipName);
                if (expected == null) throw new ApiException(0, name + ": Keine Prüfsumme für " + zipName);
                var asset = assets.First(a => J.Str(a, "name") == zipName);
                C.Status(name + ": Lade " + zipName + " (" + (J.Long(asset, "size") / 1_000_000) + " MB) …", false);
                using (var res = await Http.GetAsync(J.Str(asset, "browser_download_url"), HttpCompletionOption.ResponseHeadersRead))
                {
                    if (!res.IsSuccessStatusCode) throw new ApiException((int)res.StatusCode, name + ": Download fehlgeschlagen (HTTP " + (int)res.StatusCode + ")");
                    using (var src = await res.Content.ReadAsStreamAsync())
                    using (var dst = File.Create(tmpZip)) await src.CopyToAsync(dst);
                }
                string got;
                using (var f = File.OpenRead(tmpZip))
                using (var sha = SHA256.Create()) got = BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
                if (got != expected) throw new ApiException(0, name + ": Prüfsumme stimmt nicht – Download verworfen");

                C.Status(name + ": Entpacke …", false);
                if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true);
                await Task.Run(() => ZipFile.ExtractToDirectory(tmpZip, tmpDir)); // .NET 4.8 verweigert Einträge außerhalb des Ziels
                var exes = Directory.GetFiles(tmpDir, "*.exe", SearchOption.AllDirectories).Select(p => p.Substring(tmpDir.Length + 1)).ToList();
                var exeRel = ToolRelease.PickExe(repoName, exes);
                if (exeRel == null) throw new ApiException(0, name + ": Kein Programm im Paket gefunden");
                var version = ToolRelease.SafeVersion(J.Str(rel, "tag_name"));
                var dir = Dir(id);
                var verDir = Path.Combine(dir, "v-" + version);
                Directory.CreateDirectory(dir);
                if (Directory.Exists(verDir)) Directory.Delete(verDir, true);
                Directory.Move(tmpDir, verDir);
                File.WriteAllText(Path.Combine(dir, "installed.json"), JsonSerializer.Serialize(new { version, exe = Path.Combine("v-" + version, exeRel.Replace('/', Path.DirectorySeparatorChar)), sha256 = got, zip = zipName }));
                foreach (var old in Directory.GetDirectories(dir, "v-*").Where(d => !string.Equals(d, verDir, StringComparison.OrdinalIgnoreCase)))
                    try { Directory.Delete(old, true); } catch (IOException) { /* noch geöffnet – beim nächsten Mal */ }
                C.Ok(name + " " + version + (update ? " aktualisiert" : " ist bereit"));
            }
            catch (HttpRequestException ex) { throw new ApiException(0, name + ": GitHub nicht erreichbar – " + ex.Message); }
            finally
            {
                busy.Remove(id);
                try { if (File.Exists(tmpZip)) File.Delete(tmpZip); } catch (IOException) { }
                try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch (IOException) { }
                Render();
            }
        }

        static async Task<JsonElement> GetJson(string url, string name)
        {
            using (var res = await Http.GetAsync(url))
            {
                var text = await res.Content.ReadAsStringAsync();
                if ((int)res.StatusCode == 404) throw new ApiException(404, name + ": Für diese Anwendung gibt es noch keine Veröffentlichung");
                if ((int)res.StatusCode == 403 || (int)res.StatusCode == 429) throw new ApiException((int)res.StatusCode, name + ": GitHub begrenzt gerade die Anfragen – bitte später erneut versuchen");
                if (!res.IsSuccessStatusCode) throw new ApiException((int)res.StatusCode, name + ": GitHub antwortete mit HTTP " + (int)res.StatusCode);
                return JsonDocument.Parse(text).RootElement.Clone();
            }
        }

        Task Remove(JsonElement t) => C.Run(async () =>
        {
            var name = J.Str(t, "name");
            if (!Dlg.Confirm(C.Owner, name + " von diesem PC entfernen? Es lässt sich jederzeit neu laden.")) return;
            await Task.Run(() => Directory.Delete(Dir(J.Str(t, "id")), true));
            C.Ok(name + " entfernt");
            Render();
        }, J.Str(t, "name"));
    }
}
