// Schlanke DTOs für die AnMaCha-Cast-REST-API (src/server/http.ts, src/core/automation.ts, src/server/playout.ts).
// Bewusst nur die Felder, die das native Studio-Fenster benötigt – keine 1:1-Kopie des Servermodells.
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AnMaChaCast.Api
{
    public sealed class StationInfo
    {
        public string id { get; set; }
        public string name { get; set; }
        public string slogan { get; set; }
    }

    public sealed class MediaItem
    {
        public string id { get; set; }
        public string title { get; set; }
        public string artist { get; set; }
        public long? durationMs { get; set; }
    }

    /// <summary>Deck-Grundzustand (ohne laufendes Server-Playout): /api/v1/stations/:sid/decks.</summary>
    public sealed class DeckState
    {
        public string id { get; set; }
        public string mediaId { get; set; }
        public string status { get; set; } // empty | cued | playing | paused
    }

    /// <summary>Deck-Ansicht der laufenden Engine (mit Titel/Position): Teil von PlayoutStatus.decks.</summary>
    public sealed class EngineDeckView
    {
        public string id { get; set; }
        public string state { get; set; } // empty | cued | playing | paused
        public string mediaId { get; set; }
        public string title { get; set; }
        public string artist { get; set; }
        public long positionMs { get; set; }
        public long? durationMs { get; set; }
        public bool auto { get; set; }
        public double? tempo { get; set; }
    }

    public sealed class PlayoutStatus
    {
        public bool running { get; set; }
        public bool micOn { get; set; }
        public string program { get; set; }
        public bool automation { get; set; }
        public List<EngineDeckView> decks { get; set; }
    }

    public sealed class PlayoutView
    {
        public bool supported { get; set; }
        public PlayoutStatus status { get; set; }
    }

    public sealed class ModeView
    {
        public string mode { get; set; }   // AUTO | MANUAL | LIVE | EMERGENCY
        [JsonPropertyName("base")]
        public string Base { get; set; }   // AUTO | MANUAL (Grundbetriebsart)
        public string program { get; set; }
        public bool bus { get; set; }
        public string live { get; set; }
    }

    public sealed class CartSlot
    {
        public string id { get; set; }
        public string label { get; set; }
        public string color { get; set; }
        public string mediaId { get; set; }
        public string group { get; set; }
        /// <summary>Taste zum Auslösen (wie im Web-Studio), z. B. "q"</summary>
        public string hotkey { get; set; }
    }
}
