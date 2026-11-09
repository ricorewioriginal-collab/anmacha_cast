// Schlanker REST-Client für AnMaCha Cast API v1 (Bearer-Token) - dieselbe API, die auch das
// Web-Studio (studio/js/api.js) und die bisherige Handy-Hülle nutzen. Keine Parallel-API.
package app.anmachacast.studio.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.KSerializer
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String, message: String) : IOException(message)

@PublishedApi
internal val JSON = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
}
@PublishedApi
internal val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

/** @param serverUrl z. B. "http://192.168.1.20:8750" (ohne abschließenden Slash) */
class ApiClient(private var serverUrl: String, private var token: String?) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    fun updateAuth(serverUrl: String, token: String?) {
        this.serverUrl = serverUrl
        this.token = token
    }

    fun baseUrl(): String = serverUrl

    private fun url(path: String) = "${serverUrl.trimEnd('/')}/api/v1$path"

    @PublishedApi
    internal fun requestBuilder(path: String): Request.Builder {
        val b = Request.Builder().url(url(path))
        token?.let { b.header("Authorization", "Bearer $it") }
        return b
    }

    suspend inline fun <reified T> get(path: String): T = withContext(Dispatchers.IO) {
        execute(requestBuilder(path).get().build(), serializer())
    }

    suspend inline fun <reified B, reified T> post(path: String, body: B): T = withContext(Dispatchers.IO) {
        val json = JSON.encodeToString(serializer<B>(), body)
        execute(requestBuilder(path).post(json.toRequestBody(JSON_MEDIA_TYPE)).build(), serializer())
    }

    suspend fun postEmpty(path: String) = withContext(Dispatchers.IO) {
        executeNoBody(requestBuilder(path).post("{}".toRequestBody(JSON_MEDIA_TYPE)).build())
    }

    suspend fun postJson(path: String, json: String) = withContext(Dispatchers.IO) {
        executeNoBody(requestBuilder(path).post(json.toRequestBody(JSON_MEDIA_TYPE)).build())
    }

    fun <T> execute(request: Request, serializer: KSerializer<T>): T {
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw parseError(resp.code, text)
            return JSON.decodeFromString(serializer, text.ifBlank { "{}" })
        }
    }

    private fun executeNoBody(request: Request) {
        http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) {
                val text = resp.body?.string().orEmpty()
                throw parseError(resp.code, text)
            }
        }
    }

    private fun parseError(status: Int, text: String): ApiException {
        val body = runCatching { JSON.decodeFromString<ApiErrorBody>(text) }.getOrNull()
        return ApiException(status, body?.error ?: "http_$status", body?.message ?: "Fehler $status")
    }

    // ---------- Endpunkte ----------

    /** Kopplungscode einlösen (öffentlich, kein Token nötig - liefert eins zurück). */
    suspend fun pair(code: String, deviceName: String): PairResponse = post("/pair", PairRequest(code = code, name = deviceName))

    suspend fun stations(): List<StationDto> = get("/stations")
    suspend fun nowPlaying(stationId: String): NowPlayingDto = get("/stations/$stationId/now-playing")
    suspend fun queue(stationId: String): QueueViewDto = get("/stations/$stationId/queue")
    suspend fun sources(stationId: String): List<SourceDto> = get("/stations/$stationId/sources")
    suspend fun playout(stationId: String): PlayoutViewDto = get("/stations/$stationId/playout")
    suspend fun takeover(stationId: String, sourceId: String, force: Boolean = false) =
        postJson("/stations/$stationId/sources/$sourceId/takeover", "{\"force\":$force}")
    suspend fun release(stationId: String, sourceId: String) = postEmpty("/stations/$stationId/sources/$sourceId/release")

    // Cardwall
    suspend fun cardwall(stationId: String): List<CartSlotDto> = get("/stations/$stationId/cardwall")
    suspend fun triggerCart(stationId: String, slotId: String) = postEmpty("/stations/$stationId/cardwall/${enc(slotId)}/trigger")
    suspend fun stopCarts(stationId: String) = postEmpty("/stations/$stationId/playout/carts-stop")

    // Hörer & Interaktion: Posteingang (Wünsche, Grüße, Sprachnachrichten, Studiomail)
    suspend fun inbox(stationId: String): InboxViewDto = get("/stations/$stationId/inbox")
    /** action: done | queue | air | delete | reply (mit Text) */
    suspend fun inboxAction(stationId: String, id: String, action: String, text: String? = null) =
        postJson("/stations/$stationId/inbox/${enc(id)}/$action", if (text == null) "{}" else "{\"text\":${kotlinx.serialization.json.JsonPrimitive(text)}}")

    // KI-Programmchef (laut.fm)
    suspend fun programmchef(stationId: String): ProgrammchefDto = get("/stations/$stationId/programmchef")
    suspend fun setAutopilot(stationId: String, enabled: Boolean, brief: String, everyHours: Int) = withContext(Dispatchers.IO) {
        val body = "{\"enabled\":$enabled,\"brief\":${kotlinx.serialization.json.JsonPrimitive(brief)},\"everyHours\":$everyHours}"
        executeNoBody(requestBuilder("/stations/$stationId/programmchef/autopilot").put(body.toRequestBody(JSON_MEDIA_TYPE)).build())
    }
    suspend fun runAutopilot(stationId: String) = postEmpty("/stations/$stationId/programmchef/autopilot/run")
    suspend fun undoProgrammchef(stationId: String) = postEmpty("/stations/$stationId/programmchef/undo")

    /** Sender dieses Geräts: der erste freigegebene, bei „alle Sender“ (*) der erste vom Server. */
    suspend fun stationOf(stationIds: List<String>): String? =
        stationIds.firstOrNull { it != "*" } ?: runCatching { stations().firstOrNull()?.id }.getOrNull()

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
