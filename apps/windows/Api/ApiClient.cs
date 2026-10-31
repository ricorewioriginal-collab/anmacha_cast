// REST + SSE-Client gegen einen AnMaCha-Cast-Server (die Engine dieses PCs oder ein entfernter Server), Gegenstück zu
// studio/js/api.js. Typisierte Aufrufe für Decks/Cardwall/Modus/Playout, dazu allgemeine JSON-Aufrufe (Get/Post/Put/
// Patch/Delete) für alle übrigen Bereiche - die Seiten lesen die Antworten tolerant über Logic/Json.cs.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AnMaChaCast.Logic;

namespace AnMaChaCast.Api
{
    /// <summary>Fehler der API mit lesbarem Text vom Server und HTTP-Status (0 = nicht erreichbar).</summary>
    public sealed class ApiException : Exception
    {
        public int Status { get; }
        public ApiException(int status, string message) : base(message) { Status = status; }
    }

    public sealed class ApiClient : IDisposable
    {
        static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        readonly HttpClient http;
        readonly string token;

        /// <param name="origin">z. B. http://127.0.0.1:4848</param>
        public ApiClient(Uri origin, string token)
        {
            this.token = token;
            Origin = origin;
            // Zeitgrenzen je Aufruf (Uploads dürfen lange dauern), nicht für den ganzen Client
            http = new HttpClient { BaseAddress = origin, Timeout = System.Threading.Timeout.InfiniteTimeSpan };
            if (!string.IsNullOrEmpty(token)) http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        public Uri Origin { get; }
        public string Token => token;

        /// <summary>Absolute Adresse eines API-Pfads (für Browser/Downloads).</summary>
        public string Url(string path) => new Uri(Origin, "/api/v1" + path).AbsoluteUri;

        async Task<HttpResponseMessage> Send(HttpRequestMessage req, int timeoutSec, HttpCompletionOption option = HttpCompletionOption.ResponseContentRead)
        {
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSec)))
            {
                try { return await http.SendAsync(req, option, cts.Token).ConfigureAwait(false); }
                catch (TaskCanceledException) { throw new ApiException(0, "Der Server antwortet nicht (Zeitüberschreitung)"); }
                catch (HttpRequestException ex) { throw new ApiException(0, "Der Server ist nicht erreichbar: " + (ex.InnerException?.Message ?? ex.Message)); }
            }
        }

        static async Task<JsonElement> Parse(HttpResponseMessage res)
        {
            var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var detail = J.ErrorText(text);
                // Ablehnungen, die laut.fm (nicht AnMaCha Cast) ausspricht, tragen "lautfm": true und erklären sich selbst
                var fromLautfm = text.Contains("\"lautfm\":true");
                var hint = fromLautfm ? "" : (int)res.StatusCode == 401 ? " – bitte erneut anmelden oder koppeln" : (int)res.StatusCode == 403 ? " – dafür fehlt dieses Gerät das Recht" : "";
                throw new ApiException((int)res.StatusCode, (detail.Length > 0 ? detail : "HTTP " + (int)res.StatusCode) + hint);
            }
            if (string.IsNullOrWhiteSpace(text)) return default;
            try { using (var doc = JsonDocument.Parse(text)) return doc.RootElement.Clone(); }
            catch (JsonException) { return default; }
        }

        async Task<JsonElement> Call(HttpMethod method, string path, object body, int timeoutSec = 20)
        {
            using (var req = new HttpRequestMessage(method, "/api/v1" + path))
            {
                if (body != null) req.Content = new StringContent(body is JsonElement ? ((JsonElement)body).GetRawText() : JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                else if (method != HttpMethod.Get && method != HttpMethod.Delete) req.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                using (var res = await Send(req, timeoutSec).ConfigureAwait(false)) return await Parse(res).ConfigureAwait(false);
            }
        }

        static readonly HttpMethod PatchMethod = new HttpMethod("PATCH"); // HttpMethod.Patch gibt es im .NET Framework 4.8 nicht

        public Task<JsonElement> GetJ(string path, int timeoutSec = 20) => Call(HttpMethod.Get, path, null, timeoutSec);
        public Task<JsonElement> PostJ(string path, object body = null, int timeoutSec = 20) => Call(HttpMethod.Post, path, body, timeoutSec);
        public Task<JsonElement> PutJ(string path, object body = null, int timeoutSec = 20) => Call(HttpMethod.Put, path, body, timeoutSec);
        public Task<JsonElement> PatchJ(string path, object body = null, int timeoutSec = 20) => Call(PatchMethod, path, body, timeoutSec);
        public Task<JsonElement> DeleteJ(string path, object body = null, int timeoutSec = 20) => Call(HttpMethod.Delete, path, body, timeoutSec);

        /// <summary>Datei als Rohdaten hochladen (z. B. PUT /stations/{id}/media?name=…), ohne sie in den Speicher zu laden.</summary>
        public async Task<JsonElement> UploadFile(string path, string filePath, string contentType = "application/octet-stream")
        {
            using (var fs = File.OpenRead(filePath))
            using (var req = new HttpRequestMessage(HttpMethod.Put, "/api/v1" + path) { Content = new StreamContent(fs) })
            {
                req.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
                using (var res = await Send(req, 3600).ConfigureAwait(false)) return await Parse(res).ConfigureAwait(false);
            }
        }

        /// <summary>Rohdaten laden (Audio, Mitschnitte, CSV).</summary>
        public async Task<byte[]> Download(string path)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Get, "/api/v1" + path))
            using (var res = await Send(req, 600).ConfigureAwait(false))
            {
                if (!res.IsSuccessStatusCode) throw new ApiException((int)res.StatusCode, J.ErrorText(await res.Content.ReadAsStringAsync().ConfigureAwait(false)));
                return await res.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            }
        }

        // ---------- Ohne Anmeldung: Kopplung, Anmeldung, Erreichbarkeit ----------

        /// <summary>Server erreichbar? Liefert die Gesundheitsantwort oder wirft ApiException.</summary>
        public static async Task<JsonElement> Health(Uri origin)
        {
            using (var c = new ApiClient(origin, null)) return await c.GetJ("/health", 8).ConfigureAwait(false);
        }

        /// <summary>Kopplungscode einlösen (am Server mit "Neues Gerät koppeln" erzeugt): liefert Geräte-Token und Servername.</summary>
        public static async Task<(string Token, string ServerName)> Pair(Uri origin, string code, string deviceName)
        {
            using (var c = new ApiClient(origin, null))
            {
                var r = await c.PostJ("/pair", new { code, name = deviceName, platform = "windows" }, 15).ConfigureAwait(false);
                var token = J.Str(r, "token");
                if (token.Length == 0) throw new ApiException(0, "Der Server hat kein Token geliefert");
                return (token, J.Str(r, "server.name"));
            }
        }

        /// <summary>Mit Benutzername und Passwort anmelden: liefert das Sitzungs-Token.</summary>
        public static async Task<string> Login(Uri origin, string username, string password)
        {
            using (var c = new ApiClient(origin, null))
            {
                var r = await c.PostJ("/auth/login", new { username, password }, 15).ConfigureAwait(false);
                var token = J.Str(r, "token");
                if (token.Length == 0) throw new ApiException(0, "Der Server hat kein Token geliefert");
                return token;
            }
        }

        async Task<T> Get<T>(string path)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Get, "/api/v1" + path))
            using (var res = await Send(req, 20).ConfigureAwait(false))
            {
                var el = await Parse(res).ConfigureAwait(false);
                return el.ValueKind == JsonValueKind.Undefined ? default : JsonSerializer.Deserialize<T>(el.GetRawText(), JsonOpts);
            }
        }

        async Task<T> Send<T>(HttpMethod method, string path, object body)
        {
            var el = await Call(method, path, body).ConfigureAwait(false);
            return el.ValueKind == JsonValueKind.Undefined ? default : JsonSerializer.Deserialize<T>(el.GetRawText(), JsonOpts);
        }

        public Task<List<StationInfo>> Stations() => Get<List<StationInfo>>("/stations");
        public Task<List<MediaItem>> Library(string stationId) => Get<List<MediaItem>>($"/stations/{Enc(stationId)}/media");
        public Task<List<DeckState>> Decks(string stationId) => Get<List<DeckState>>($"/stations/{Enc(stationId)}/decks");
        public Task<List<CartSlot>> Cardwall(string stationId) => Get<List<CartSlot>>($"/stations/{Enc(stationId)}/cardwall");
        public Task<ModeView> Mode(string stationId) => Get<ModeView>($"/stations/{Enc(stationId)}/mode");
        public Task<PlayoutView> Playout(string stationId) => Get<PlayoutView>($"/stations/{Enc(stationId)}/playout");

        public Task<ModeView> SetMode(string stationId, string mode) =>
            Send<ModeView>(HttpMethod.Put, $"/stations/{Enc(stationId)}/mode", new { mode });

        public Task SetMic(string stationId, bool on) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/mic", new { on });

        public Task<PlayoutView> StartPlayout(string stationId) =>
            Send<PlayoutView>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/start", new { });

        public Task<PlayoutView> StopPlayout(string stationId) =>
            Send<PlayoutView>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/stop", null);

        public Task DeckAction(string stationId, string deckId, string action, object body = null) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/decks/{Enc(deckId)}/{Enc(action)}", body ?? new { });

        public Task TriggerCart(string stationId, string slotId) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/cardwall/{Enc(slotId)}/trigger", null);

        static string Enc(string s) => Uri.EscapeDataString(s ?? "");

        /// <summary>
        /// Server-Sent-Events abonnieren (dieselben Ereignistypen wie studio/js/api.js). Läuft bis zum
        /// übergebenen Abbruch-Token oder bis die Verbindung abbricht; der Aufrufer kümmert sich ums
        /// Neuverbinden (siehe MainWindow.WatchEvents).
        /// </summary>
        public async Task Subscribe(string stationId, Action<string, string> onEvent, CancellationToken ct)
        {
            var url = $"/api/v1/events?station={Enc(stationId)}&token={Enc(token)}";
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            using (var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false))
            {
                res.EnsureSuccessStatusCode();
                using (var stream = await res.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var reader = new StreamReader(stream))
                {
                    string type = null;
                    var data = new StringBuilder();
                    while (!ct.IsCancellationRequested)
                    {
                        var line = await reader.ReadLineAsync().ConfigureAwait(false);
                        if (line == null) break; // Verbindung vom Server beendet
                        if (line.Length == 0)
                        {
                            if (type != null && data.Length > 0) onEvent(type, data.ToString());
                            type = null;
                            data.Clear();
                            continue;
                        }
                        if (line.StartsWith("event:", StringComparison.Ordinal)) type = line.Substring(6).Trim();
                        else if (line.StartsWith("data:", StringComparison.Ordinal)) data.Append(line.Substring(5).Trim());
                    }
                }
            }
        }

        public void Dispose() => http.Dispose();
    }
}
