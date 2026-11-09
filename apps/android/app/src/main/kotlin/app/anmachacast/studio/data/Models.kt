// Datenmodelle der AnMaCha-Cast-REST-API v1 (nur die für Studio-Fernsteuerung/GO-LIVE genutzten Felder).
// Alle Felder optional mit Vorgabewert: ein unbekanntes/fehlendes Feld lässt die App nicht abstürzen,
// sondern zeigt im Zweifel "unbekannt" - robuster als ein starres Pflichtschema gegen Server-Drift.
package app.anmachacast.studio.data

import kotlinx.serialization.Serializable

@Serializable
data class StationDto(
    val id: String = "",
    val name: String = "",
    val slogan: String = "",
    val primaryColor: String? = null,
    val accentColor: String? = null,
    val genre: String? = null,
)

@Serializable
data class MediaDto(
    val id: String = "",
    val title: String = "",
    val artist: String = "",
    val album: String? = null,
    val category: String? = null,
    val durationMs: Long? = null,
)

@Serializable
data class NowPlayingDto(
    val mediaId: String? = null,
    val deck: String? = null,
    val startedAt: Long? = null,
    val media: MediaDto? = null,
    val positionMs: Long? = null,
)

@Serializable
data class QueueItemDto(
    val uid: String = "",
    val mediaId: String = "",
    val origin: String? = null,
    val media: MediaDto? = null,
    val startsAt: Long? = null,
)

@Serializable
data class QueueViewDto(
    val items: List<QueueItemDto> = emptyList(),
)

@Serializable
data class SourceDto(
    val id: String = "",
    val name: String = "",
    val type: String = "",
    val state: String = "",
    val priority: Int = 0,
    val healthy: Boolean = true,
    val target: String? = null,
)

@Serializable
data class PlayoutStatusDto(
    val running: Boolean = false,
    val format: String? = null,
    val bitrateKbps: Int? = null,
    val encoder: String? = null,
    val silent: Boolean = false,
    val automation: Boolean = false,
    val program: String? = null,
)

@Serializable
data class PlayoutViewDto(
    val status: PlayoutStatusDto? = null,
)

@Serializable
data class PairRequest(
    val code: String,
    val name: String,
    val platform: String = "android",
)

@Serializable
data class PairResponseDevice(
    val id: String = "",
    val name: String = "",
    val role: String = "",
    val stationIds: List<String> = emptyList(),
)

@Serializable
data class PairResponseServer(
    val name: String = "",
    val version: String = "",
    val api: String = "",
)

@Serializable
data class PairResponse(
    val token: String = "",
    val device: PairResponseDevice = PairResponseDevice(),
    val server: PairResponseServer = PairResponseServer(),
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null,
)

/** Verbindungsdaten eines gekoppelten Servers, lokal verschlüsselt gespeichert (siehe TokenStore). */
data class SavedConnection(
    val serverUrl: String,
    val token: String,
    val deviceName: String,
    val stationIds: List<String>,
)

// ---------- Cardwall, Hörer & Interaktion, KI-Programmchef (native Bereiche, Schritt 2) ----------

@Serializable
data class CartSlotDto(
    val id: String = "",
    val label: String = "",
    val color: String? = null,
    val mediaId: String? = null,
    val hotkey: String? = null,
)

@Serializable
data class InboxItemDto(
    val id: String = "",
    /** request | message | voice */
    val kind: String = "message",
    val at: Long = 0,
    /** new | done */
    val status: String = "new",
    val name: String? = null,
    val text: String? = null,
    val title: String? = null,
    val mediaId: String? = null,
    val wishId: String? = null,
    val email: String? = null,
    val subject: String? = null,
    val source: String? = null,
)

@Serializable
data class InboxViewDto(
    val items: List<InboxItemDto> = emptyList(),
    val unread: Int = 0,
    val lautfm: Boolean = false,
)

@Serializable
data class AutopilotDto(
    val enabled: Boolean = false,
    val brief: String = "",
    val everyHours: Int = 24,
    val running: Boolean = false,
)

@Serializable
data class UndoDto(val at: Long = 0, val summary: String = "")

@Serializable
data class ChefLogDto(val at: Long = 0, val kind: String = "", val text: String = "", val ok: Boolean = true)

@Serializable
data class ProgrammchefDto(
    val autopilot: AutopilotDto = AutopilotDto(),
    val undo: UndoDto? = null,
    val log: List<ChefLogDto> = emptyList(),
    val ai: Boolean = false,
)
