# Funktionsabgleich: AnMaCha-Dashboard → AnMaCha Cast

Quellen: `index.html` und `sam.html` (eigene Server-Automation, „AnMaCha Broadcaster – Live-Automation“),
`automation.html` (laut.fm Radioadmin), `ki-tools.html` (KI Tools) und `radioadmin-api-spec`.
AnMaCha Cast bildet diese Funktionen **ohne PHP-Server** lokal ab: `AnMaCha Cast.exe` bzw. `npm start`.

Legende: ✅ vorhanden · 🟡 teilweise · ⏳ geplant

## Server-Automation (index.html / sam.html)

| Funktion | Status | In AnMaCha Cast |
|---|---|---|
| Decks A/B (Auto-DJ, Crossfade), C/D manuell | ✅ | 4 Decks, Automation, Server-Playout 24/7 |
| Cue-Marke, Loop, Tempo, ±10 s | 🟡 | Cue-In/Segue pro Titel, Springen per Klick, ±10-s-Tasten am Deck. Loop/Tempo (Zeitdehnung ohne Tonhöhenänderung) ⏳ |
| Bibliothek mit Ordnern, Titel-/Ordner-Upload, Drag & Drop | ✅ | Ordner, Ordner-Upload, Drag & Drop |
| Titeldaten bearbeiten (F2), Löschen | ✅ | ✎ im Archiv |
| Warteschlange: füllen aus Ordner/Kategorie, leeren, verschieben | ✅ | „Aus Ordner …“, Drag & Drop |
| M3U importieren/exportieren | ✅ | Planung → Playlists, Queue → M3U |
| URL/Stream zur Warteschlange | ✅ | „＋ URL“, auch im Zeitplan |
| Rotation & AutoDJ | ✅ | Sendeuhr + Rotationsregeln |
| Zeitplan (einmalig/stündlich/täglich/Mo–Fr/wöchentlich; Crossfade oder über Musik) | ✅ | Planung → Zeitplan |
| Uhr (Minuten-Events pro Stunde/Tag) | ✅ | Planung → Stunden-Uhr |
| Programm: Playlists & Sendeplan (Zeitfenster → Playlist) | ✅ | Planung → Sendeplan |
| Sound FX / Jingles / Pads | ✅ | Cardwall (12 Carts, Gruppen, Ducking) |
| Sprecher/Mikrofon, Live übernehmen, zurück zur Automatik | ✅ | MIC LIVE, Source Priority, Freigeben |
| Mithören & Audio-Routing | ✅ | 🎧 Mithören, CUE/PFL auf wählbarem zweiten Ausgabegerät (setSinkId) |
| Encoder / Sender, Zusatz-Streams (Simulcast), Stream-Status | ✅ | Ausgänge (mehrere Icecast/laut.fm, ?prio=) |
| Recorder / Replays, zeitgesteuerte Aufnahme | ✅ | Recorder |
| Titelanzeige senden | ✅ | „Titelanzeige senden …“ |
| Verlauf / Sendungs-Rückblick | ✅ | Planung → Verlauf (CSV). Rückblick: Titelliste, Hörer-Spitze, Datenmenge je Zeitraum (CSV/E-Mail) |
| Voicetrack (über Musik sprechen, speichern) | ✅ | 🎙 an der Queue - Moderationslink zwischen zwei Titeln aufnehmen, landet als eigener Titel exakt an der Stelle |
| Einstellungen: Notfall-Programm, Sound-Prozessor | ✅ | Notfall-Auswahl, volle DSP-Kette (10-Band-EQ, Hochpass, Multiband-Kompander, Kompressor, Limiter, AGC/Loudnorm je Encoder-Preset) |
| Nachrichten & Wetter, Werbe-Trigger (laut.fm) | ⏳ | nur über reale laut.fm-Schnittstellen |
| Studiomail (Hörernachrichten), Prep-Feeds (RSS) | 🟡 | Studiomail (Hörernachrichten/Anfragen/Sprachnachrichten als Inbox) vorhanden. Prep-Feeds (externe RSS-Show-Vorbereitung importieren) ⏳ |
| HLS-Stream (m3u8) | ✅ | eigener HLS-Ausgang (ffmpeg-Segmentierung, konfigurierbare Bitrate/Segmentlänge) |
| Cloud-Kachel (Team-Dateien) | ⏳ | Cloud-Adapter (WebDAV/S3/NAS) laut Spezifikation |

## lautCast (vormals „laut.fm" im Menü) - Radioadmin-Anbindung (automation.html als 1:1-Funktionsreferenz)

Der Menüpunkt heißt in AnMaCha Cast **lautCast** (reine UI-Bezeichnung der AnMaCha Cast-Funktion); „laut.fm" bleibt unverändert der Name des externen Dienstes, zu dem verbunden wird. Siehe `docs/LAUTCAST_PROGRESS.md` für den laufenden, phasenweisen Abgleich gegen `automation.html` als Funktionsreferenz.

| Funktion | Status |
|---|---|
| Verbindung per Radioadmin-Token (verschlüsselt lokal), Stationswahl | ✅ |
| Übersicht: Station, Aktiv-Status + Aktivieren, Hörer, laufende Playlist, aktueller Titel | ✅ |
| Playlists: anlegen, bearbeiten, löschen, Titel hinzufügen/entfernen | 🟡 - Änderungen wirken sofort live; die gebündelte „Speichern (N)"-Zwischenablage aus der Referenz fehlt noch |
| Titel: Suche, Vorhören, zu Playlist, MP3-Upload, Uploads in Verarbeitung | 🟡 - Upload fehlt Metadaten-Felder (Künstler/Titel/Genre/Jahr/Privat), Verarbeitungs-Poll mit automatischem Status und automatischer Nachbearbeitung der Metadaten; kein Bearbeiten-/Löschen-Dialog für bestehende Titel |
| Automations-Algorithmen (16 Vorlagen, Zuweisung je Playlist) | ✅ - lokaler Testlauf vor dem Speichern (wie in der Referenz) fehlt noch |
| Tags & Felder (Typ/Genre/Jahr/Popularität/Tags), In-App-Referenz dazu | 🟡 - Tags bearbeitbar; Typ/Privat/Jahr nur beim Erstellen über Radioadmin direkt, keine In-App-Felderklärung wie in der Referenz |
| Sendeplan: Wochenraster (Slot = Tag×24+Stunde), Stunden belegen | ✅ |
| Statistik: Hörer jetzt, Einschaltungen, gespielte Titel 24 h | ✅ |
| Benutzer: einladen, Rolle ändern, entfernen | ✅ |
| Station: Beschreibung, Format, DJs, Links, Genres, Logo | ✅ |
| Live: Zugangsdaten → als AnMaCha Cast-Ausgang übernehmen (mit ?prio=) | ✅ |
| lautcast (11/2026): Live-Puffer `live_buffer` 15–90 s, Sendebeginn zum Songwechsel `wait_for_song_end`, Status des Streamingservers anzeigen und Ansagen hochladen (mit den gespeicherten Live-Zugangsdaten), schnelles Neuverbinden nach Hängern | ✅ |
| „Jetzt auf laut.fm“-Live-Kachel (Cover, Fortschrittsbalken, Stream-Vorhören) | ⏳ |
| Lifehacks (Massen-Tagger, Jahr-Batch-Füllen, Top-24h-Playlist-Builder) | ⏳ |
| Statistik-Mail-Report | ⏳ - lokale Zusatzfunktion der Referenz (cron.php), kein reiner laut.fm-API-Aufruf |

## KI Tools (ki-tools.html)

Voice Studio, KI-Assistent, Musik-Studio (Suno), Spot-Werkstatt, Sendeablauf-Planer, Transkription und Office-Studio
kommen in die AnMaCha Cast-AI-Schicht (Phase 8 der Roadmap). Dort gelten eigene Provider-Keys, lokale bzw. kostenlose Engines
(Piper/Whisper) zuerst und ein Kosten-Ledger. AI darf nie Single Point of Failure sein.

## LunarCaster DJ 1.2 Beta 5 (Funktionsvorlage für den lokalen Betrieb)

LunarCaster wird nicht mehr gepflegt und darf frei verwendet werden. Übernommen wurden **nur Funktionsideen**.
Die mitgelieferten Fremdbibliotheken (BASS/Bass.Net von un4seen, Winamp-DSP-Plugins, Encoder-EXEs) sind eigenständige
Drittsoftware mit eigenen Lizenzen und sind **nicht** Teil von AnMaCha Cast. AnMaCha Cast nutzt stattdessen ffmpeg.

| LunarCaster | Status | AnMaCha Cast |
|---|---|---|
| Decks A/B, Auto-Crossfade, Fade-In/Fade-Out/Next-Start | ✅ | Überblendung, Einblenden, Segue pro Titel |
| Mikrofon + Voice-Over-Lautstärke, Aux-Eingänge in den Stream | ✅ | Server-Automation: Mikrofon/Line-In am PC mit Ducking (🎙 Mikro) |
| Lokale Lautstärke / Mithören | ✅ | Programm über PC-Lautsprecher (ffplay) oder 🎧 |
| 10-Band-EQ, DSP | ✅ | Master-DSP: 10-Band-EQ, Kompressor, Limiter |
| Encoder MP3/AAC/OGG/OPUS | ✅ | MP3, AAC, Ogg/Opus |
| Server: Icecast, SHOUTcast v1, SHOUTcast v2, mehrere, Auto-Reconnect | ✅ | Ausgänge inkl. SHOUTcast v1/v2 (Stream-ID) |
| Hörerzahl vom Server | ✅ | Icecast status-json, SHOUTcast 7.html bzw. stats |
| Songdatenbank mit ID3-Tags, Vorschau, Suche, Historie | ✅ | ffprobe liest Titel, Interpret, Album, Genre, Jahr und BPM |
| Zufallstitel, Queue mischen, M3U öffnen/speichern | ✅ | |
| Sound-FX-Ordner | ✅ | Cardwall und Ordner |
| Event-Kalender (Wochentage, URL-Events, Wiederholung) | ✅ | Zeitplan, Stunden-Uhr, Sendeplan |
| Nachricht senden (Titelanzeige) | ✅ | Titelanzeige senden |
| Winamp-DSP-Plugins | ✗ | bewusst nicht: proprietär und nur für Windows |

## AzuraCast, mAirList, RadioDJ, SAM Broadcaster (echte Fremdsysteme)

Öffentlich dokumentierte Funktionen der vier verbreitetsten Systeme, abgeglichen mit dem tatsächlichen AnMaCha Cast-Code
(nicht mit Werbetexten). Quellen: azuracast.com/docs, github.com/AzuraCast/AzuraCast (AGPL-3.0, nur zum Vergleich
gelesen, kein Code übernommen), mairlist.com/en/products/radio-automation, radiodj.ro, spacial.com (SAM Broadcaster).

| Funktion | AzuraCast | mAirList | RadioDJ | SAM Broadcaster | AnMaCha Cast |
|---|---|---|---|---|---|
| AutoDJ mit Playlist-Typen (Standard, Zeitfenster, X-mal/Stunde) | ✅ | ✅ | ✅ (Rotation) | ✅ | ✅ Sendeuhr, Zeitplan, Rotation |
| Live-Assist/Automation-Umschaltung, Mikrofon mit Ducking | ✅ Web-DJ | ✅ | ✅ | ✅ | ✅ Manuell/24-7-AutoDJ, 🎙 Mikro |
| Cartwall | 🟡 (über Playlisten) | ✅ | ✅ | ✅ | ✅ 12 Carts, Gruppen |
| **Motion Mixes** (Foster Kent, [fosterkent.com/motionmixes](https://fosterkent.com/motionmixes/)): Touch-Button-Instrument mit Intro/Loop/Drop/Outro-Tasten, Endlos-Loop mit Weiterschalten, Dynamic Slider zur Echtzeit-"Vertonung", Live-Aufnahme als neuer Cart, eigene Inhaltsbibliothek, GPIO/MIDI/UDP | ✗ | ✗ | ✗ | ✗ | 🟡 **Endlos-Loop mit Weiterschalten umgesetzt**: `loopEndMs` je Cart (Mediathek); Carts und von Hand gestartete Decks wiederholen Cue-In…Loop-Ende nahtlos im Mixer (`Voice.readBlock`, PCM-Mitschnitt, Decoder pausiert) bis „∞ Weiter“ (Cardwall-Knopf, Deck-Knopf, `POST /playout/loop-advance`, Deck-Aktion `advance`) - dann folgt Drop/Outro sample-genau. Die Automation loopt nie. Offen: Dynamic Slider, Live-Aufnahme als Cart, GPIO/MIDI/UDP. |
| **Voice Tracking** (Moderationslink zwischen zwei Titeln aufnehmen) | ✗ | ✅ | 🟡 (Plugin) | ✅ | ✅ 🎙 an der Queue |
| Hörer-Wünsche/-Charts über eine öffentliche Seite | ✅ | ✗ | 🟡 (eigener Webserver nötig) | ✅ (10 Min. Verzögerung) | ✅ Hörerbereich, ohne feste Verzögerung |
| Mehrere Sender/Stationen in einer Installation | ✅ | 🟡 (Multi-Instance) | ✗ | ✗ | ✅ |
| Rollenbasierte Benutzerverwaltung | ✅ | 🟡 (Windows-Konten) | 🟡 (ein Admin-Login) | 🟡 | ✅ |
| Web-Oberfläche (kein Windows nötig) | ✅ | ✗ (Windows) | ✗ (Windows) | ✗ (Windows) | ✅ (plus eigenständiges Windows-/Android-Programm) |
| Windows-Programm: echte native Bedienoberfläche (kein Browser/WebView als Hauptoberfläche) | — | ✅ (nativ) | ✅ (nativ) | ✅ (nativ) | 🟡 primäre Sendebedienung nativ (WPF: Senderwahl, On-Air/Modus/Mikrofon/Sendung, Decks A–D, Cardwall), Rest (Mediathek, Playlisten, Sendeplan, Einstellungen, KI-Werkzeuge, Hörer-Statistik) noch über WebView2-Fallback-Fenster – siehe `docs/architecture/MULTI_PLATFORM.md` |
| Remote-Relays / mehrere Ausgänge gleichzeitig | ✅ | 🟡 | 🟡 (externer Encoder) | ✅ | ✅ Ausgänge mit Priorität |
| Webhooks/Integrationen | ✅ Slack/Discord/TuneIn | 🟡 (REST/Skripte) | ✗ | ✗ | ✅ signierte Webhooks, Telegram |
| Sound-Prozessor (EQ/Kompressor/Lautheit) | 🟡 (Liquidsoap-Filter) | ✅ (VST/Winamp-Plugins) | ✅ (Plugin) | ✅ 5-Band | ✅ 10-Band-EQ, Multiband, EBU-R128-Lautheitsangleich pro Titel |
| Podcast-/RSS-Hosting (Episoden, Feed) | ✅ | ✗ | 🟡 | ✗ | ✅ eigener RSS-2.0-Feed (iTunes-Namensraum) aus eigenen Mitschnitten |
| Erweiterte Playlisten mit eigenem Skript (Liquidsoap von Hand) | ✅ „Advanced Playlist“ | ✗ | ✗ | ✗ | ⏳ nicht geplant (AnMaCha Cast bleibt ohne Skriptsprache bedienbar) |
| Fernsteuerung professioneller Misch­pulte (DHD, Lawo, Studer, Axia, Ember+) | ✗ | ✅ | ✗ | ✗ | ✗ bewusst nicht: Hardware-spezifisch, sehr kleine Zielgruppe |
| MusicMaster-Anbindung (externe Musikplanung) | ✗ | ✅ | ✗ | ✗ | ✗ nicht geplant: eigene Rotation/Sendeuhr deckt den Bedarf |
| Monetarisierung (Musikverkauf, Werbe-/Merch-Links) | ✗ | ✗ | ✗ | ✅ | ✗ nicht der Zweck von AnMaCha Cast (Hobbyprojekt, ohne Gewähr) |
| Motion-Mix-Video aus einer Playlist (animierter Hintergrund, Wellenform, Titel-Einblendungen, z. B. für YouTube) | ✗ | ✗ | ✗ | ✗ | ✅ eigene, generative Visuals (ffmpeg gradients/showwaves), keine fremden Assets |

**Einordnung:** Bei Kern-Playout, Lautheit/DSP, Mehr-Sender-Betrieb und Hörer-Interaktion liegt AnMaCha Cast vor allen vier
Vergleichssystemen. Voice Tracking und Podcast-/RSS-Hosting – die beiden zuletzt noch offenen, tatsächlich
nachgefragten Funktionen – sind inzwischen umgesetzt (siehe oben). Alles andere in der Tabelle ist entweder
Nischenhardware, eine externe Abhängigkeit, die dem Ziel von AnMaCha Cast „läuft komplett lokal, ohne
Zusatzsoftware“ widerspräche, oder außerhalb des Projektzwecks.
