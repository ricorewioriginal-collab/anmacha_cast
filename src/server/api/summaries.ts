// Beschreibung jeder Route der REST-API v1 (Quelle für OpenAPI-Spezifikation und docs/API-REFERENCE.md).
// Format je Zeile: `METHODE /pfad | Zusammenfassung` (Pfad ohne /api/v1, Parameter als :name).
// Ein Test stellt sicher, dass jede registrierte Route hier beschrieben ist und keine Zeile ins Leere zeigt.

export const SUMMARIES = `
GET /me | Eigene Identität: Rollen, Rechte, erlaubte Sender
POST /auth/logout | Sitzung beenden
POST /auth/password | Eigenes Passwort ändern
GET /users | Benutzer auflisten (Administrator)
POST /users | Benutzer anlegen (Administrator)
PATCH /users/:id | Benutzer ändern: Rolle, Sender, Sperre, Passwort (Administrator)
DELETE /users/:id | Benutzer löschen (Administrator)
GET /capabilities | Fähigkeiten dieses Servers (Ausgabearten, Engine, Funktionen)
GET /audit | Audit-Protokoll lesen
GET /me/profile | Eigenes Profil lesen
PATCH /me/profile | Eigenes Profil ändern (Name, Links)
GET /me/tokens | Eigene API-Schlüssel auflisten
POST /me/tokens | Eigenen API-Schlüssel erzeugen (Klartext nur in dieser Antwort)
DELETE /me/tokens/:id | Eigenen API-Schlüssel widerrufen
GET /site | Ankündigungs-Banner und Wartungsmeldung lesen
PUT /site | Ankündigungs-Banner und Wartungsmeldung setzen
GET /tokens | Alle API-Schlüssel auflisten (Administrator)
POST /tokens | Sender-unabhängigen API-Schlüssel erzeugen (Administrator)
DELETE /tokens/:id | API-Schlüssel widerrufen (Administrator)
GET /stations | Sender auflisten
GET /network | Senderverbund: alle sichtbaren Sender mit Status
POST /stations | Sender anlegen
GET /stations/:sid | Sender lesen
PATCH /stations/:sid | Sender ändern (Name, Slogan, Genre, Farbe, öffentlich)
DELETE /stations/:sid | Sender löschen
PUT /stations/:sid/logo | Sender-Logo hochladen (Bilddaten, höchstens 2 MB)
DELETE /stations/:sid/logo | Sender-Logo entfernen
GET /stations/:sid/sources | Quellen auflisten (Live-Eingänge, Relays)
POST /stations/:sid/sources | Quelle anlegen
PATCH /stations/:sid/sources/:id | Quelle ändern
DELETE /stations/:sid/sources/:id | Quelle löschen
POST /stations/:sid/sources/:id/password | Zugangspasswort einer Quelle neu erzeugen
POST /stations/:sid/sources/:id/takeover | Live-Übernahme durch diese Quelle
POST /stations/:sid/sources/:id/release | Live-Übernahme beenden
POST /stations/:sid/sources/:id/health | Gesundheitszustand einer Quelle melden
POST /stations/:sid/sources/:id/chunks | Audio-Häppchen einer Quelle senden (Browser-/App-Live-Übertragung)
GET /stations/:sid/outputs | Ausgänge auflisten (Icecast, Shoutcast, laut.fm …)
POST /stations/:sid/outputs | Ausgang anlegen
PATCH /stations/:sid/outputs/:id | Ausgang ändern oder ein-/ausschalten
DELETE /stations/:sid/outputs/:id | Ausgang löschen
GET /stations/:sid/own-streams | Eigene Zusatz-Streams mit Zeitfenstern auflisten
POST /stations/:sid/own-streams | Zusatz-Stream anlegen
PATCH /stations/:sid/own-streams/:id | Zusatz-Stream ändern
DELETE /stations/:sid/own-streams/:id | Zusatz-Stream löschen
GET /stations/:sid/stream-profiles | Stream-Profile (Codec, Bitrate) auflisten
POST /stations/:sid/stream-profiles | Stream-Profil anlegen
PATCH /stations/:sid/stream-profiles/:id | Stream-Profil ändern
DELETE /stations/:sid/stream-profiles/:id | Stream-Profil löschen
GET /stations/:sid/media | Bibliothek durchsuchen (q, category, limit)
PUT /stations/:sid/media | Audiodatei hochladen (Rohdaten im Body, ?name=Titel.mp3)
PATCH /stations/:sid/media/:id | Titel-Metadaten ändern (Titel, Interpret, Kategorie, Tags)
DELETE /stations/:sid/media/:id | Titel löschen
GET /stations/:sid/media/:id/file | Audiodatei laden (mit Range-Unterstützung)
GET /music-hub/items | MusicHub: Einträge auflisten
POST /music-hub/items | MusicHub: Eintrag aus der eigenen Bibliothek anlegen
GET /music-hub/collections | MusicHub: Sammlungen auflisten
GET /music-hub/recipients | MusicHub: mögliche Empfänger-Sender auflisten
POST /music-hub/collections | MusicHub: Sammlung anlegen
PUT /music-hub/collections/:id/items | MusicHub: Inhalt einer Sammlung setzen
GET /music-hub/:kind/:id/grants | MusicHub: Freigaben eines Eintrags oder einer Sammlung lesen
POST /music-hub/:kind/:id/grants | MusicHub: Freigabe an einen Sender erteilen
DELETE /music-hub/grants/:id | MusicHub: Freigabe widerrufen
GET /music-hub/uploads/quota | MusicHub: Upload-Kontingent lesen
GET /music-hub/transfers | MusicHub: Übertragungen auflisten
PUT /music-hub/uploads | MusicHub: Datei in den Hub hochladen
DELETE /music-hub/items/:id | MusicHub: Eintrag löschen
GET /music-hub/items/:id/preflight | MusicHub: Vorabprüfung (Format, Länge, Lautheit)
GET /music-hub/items/:id/lautcast-capability | MusicHub: Eignung für laut.fm-Übertragung prüfen
POST /music-hub/items/:id/lautcast-transfer | MusicHub: Eintrag zu laut.fm übertragen
POST /music-hub/items/:id/stage | MusicHub: Eintrag in die eigene Bibliothek übernehmen
PUT /music-hub/items/:id/replace | MusicHub: Datei eines Eintrags ersetzen
GET /music-hub/nextcloud | MusicHub: Nextcloud-Verbindung lesen
PUT /music-hub/nextcloud | MusicHub: Nextcloud-Verbindung speichern
GET /music-hub/nextcloud/list | MusicHub: Nextcloud-Ordner auflisten
POST /music-hub/nextcloud/import | MusicHub: Datei aus Nextcloud importieren
POST /music-hub/nextcloud/import-folder | MusicHub: Ordner aus Nextcloud importieren
POST /music-hub/nextcloud/import-folder-job | MusicHub: Ordner-Import als Hintergrundauftrag starten
GET /music-hub/nextcloud/jobs | MusicHub: Nextcloud-Aufträge auflisten
POST /music-hub/nextcloud/jobs/:id/restart | MusicHub: Nextcloud-Auftrag neu starten
GET /music-hub/items/:id/preview | MusicHub: Vorschau-Audio laden
GET /music-hub/items/:id/download | MusicHub: Datei herunterladen
GET /music-hub/items/:id/cover | MusicHub: Cover-Bild laden
GET /stations/:sid/queue | Warteschlange lesen
POST /stations/:sid/queue | Titel einreihen: { mediaId, index? }
POST /stations/:sid/queue/next | Nächsten Titel aus der Rotation nachlegen
POST /stations/:sid/queue/fill | Warteschlange aus der Rotation auffüllen
POST /stations/:sid/queue/clear | Warteschlange leeren
POST /stations/:sid/queue/:uid/move | Eintrag in der Warteschlange verschieben
DELETE /stations/:sid/queue/:uid | Eintrag aus der Warteschlange entfernen
GET /stations/:sid/automation | Automationseinstellungen lesen
PATCH /stations/:sid/automation | Automationseinstellungen ändern
GET /stations/:sid/now-playing | Aktueller Titel mit Dauer, Position und nächstem Titel
GET /stations/:sid/automation-source | Quelle der Automation erkennen (AnMaCha Cast oder laut.fm)
POST /stations/:sid/now-playing | Titel aus der Bibliothek als laufend setzen: { mediaId, deck }
GET /stations/:sid/decks | Deck-Zustand lesen (A bis D)
POST /stations/:sid/decks/:deck/:action | Deck bedienen: load, play, pause, stop, eject, seek, tempo, loop, advance
PUT /stations/:sid/decks/:deck | Deck mit einem Titel beladen
GET /stations/:sid/playout | Playout-Zustand lesen (Lautstärke, Überblendung, Mikrofon)
PATCH /stations/:sid/playout | Playout-Einstellungen ändern
POST /stations/:sid/playout/start | Automation starten
POST /stations/:sid/playout/stop | Automation stoppen
POST /stations/:sid/playout/mic | Mikrofon (Ducking) ein- oder ausschalten
POST /stations/:sid/stream-profiles-test | Stream-Profil testen
GET /system | System: Betriebssystem, Version, Auslastung
GET /database | Datenbankstatus lesen
GET /audio | Audio-Engine-Status lesen
GET /encoder | Encoder-Status lesen
GET /stream | Stream-Status lesen
GET /ai | KI-Dienste: Übersicht über Anbieter und Zustand
POST /stations/:sid/playout/carts-stop | Alle Carts stoppen
POST /stations/:sid/playout/loop-advance | Endlos-Schleife zum nächsten Titel weiterschalten
POST /stations/:sid/quick/:category | Zufälligen Jingle oder Spot einer Kategorie spielen
GET /stations/:sid/media/:id/cover | Cover-Bild eines Titels laden
GET /stations/:sid/media/:id/waveform | Wellenform eines Titels (600 Spitzenwerte)
POST /stations/:sid/media/:id/voice-edit | Voice Studio: Titel schneiden und aufbereiten (Vorschau oder neuer Titel)
GET /audio-devices | Audio-Geräte des Servers auflisten
POST /stations/:sid/queue/shuffle | Warteschlange mischen
POST /stations/:sid/playout/skip | Aktuellen Titel überspringen
GET /stations/:sid/mode | Betriebsart lesen (auto oder live)
PUT /stations/:sid/mode | Betriebsart setzen (auto oder live)
POST /stations/:sid/onair | On-Air-Status setzen
GET /stations/:sid/folders | Überwachte Ordner der Bibliothek auflisten
GET /stations/:sid/media/integrity | Bibliothek auf fehlende Dateien prüfen
POST /stations/:sid/media/:id/relink | Fehlende Datei eines Titels neu verknüpfen
POST /stations/:sid/media/url | Audiodatei von einer Adresse laden
POST /stations/:sid/queue/fill-from | Warteschlange aus einer Playlist auffüllen
GET /stations/:sid/queue.m3u | Warteschlange als M3U-Datei
POST /stations/:sid/m3u/import | M3U-Liste als Playlist importieren
POST /stations/:sid/metadata | Titelanzeige für die Ausgänge senden: { artist, title }
GET /stations/:sid/history | Verlauf der gespielten Titel
GET /stations/:sid/playlists | Playlists auflisten
POST /stations/:sid/playlists | Playlist anlegen
PATCH /stations/:sid/playlists/:id | Playlist ändern (Name, Titel)
DELETE /stations/:sid/playlists/:id | Playlist löschen
POST /stations/:sid/playlists/:id/play | Playlist sofort spielen
POST /stations/:sid/playlists/:id/shuffle | Playlist mischen
GET /stations/:sid/smart-blocks | Smart-Blöcke (regelbasierte Titelauswahl) auflisten
POST /stations/:sid/smart-blocks | Smart-Block anlegen
POST /stations/:sid/smart-blocks/preview | Smart-Block-Auswahl vorab berechnen
PATCH /stations/:sid/smart-blocks/:id | Smart-Block ändern
DELETE /stations/:sid/smart-blocks/:id | Smart-Block löschen
POST /stations/:sid/smart-blocks/:id/playlist | Aus einem Smart-Block eine Playlist erzeugen
GET /stations/:sid/rotation-pool | Rotationspool lesen
PUT /stations/:sid/rotation-pool | Rotationspool setzen
GET /stations/:sid/lifehacks/health | Playlist-Lifehacks: Gesundheitsprüfung der Bibliothek
GET /stations/:sid/lifehacks/runtime/:id | Playlist-Lifehacks: Laufzeit einer Playlist
POST /stations/:sid/lifehacks/merge | Playlist-Lifehacks: Playlists zusammenführen
POST /stations/:sid/lifehacks/top-tracks | Playlist-Lifehacks: Top-Titel in eine Playlist
POST /stations/:sid/lifehacks/mass-tag | Playlist-Lifehacks: Tags für viele Titel setzen
GET /stations/:sid/lifehacks/analyze/:id | Playlist-Lifehacks: Playlist analysieren
GET /stations/:sid/lifehacks/find | Playlist-Lifehacks: Titel finden
POST /stations/:sid/lifehacks/fill-year | Playlist-Lifehacks: fehlende Erscheinungsjahre ergänzen
GET /stations/:sid/lifehacks/compare | Playlist-Lifehacks: Playlists vergleichen
POST /stations/:sid/lifehacks/delete-many | Playlist-Lifehacks: viele Titel löschen
GET /stations/:sid/planning | Planung: Sendeplan, Uhr-Ereignisse, Aufgaben
GET /stations/:sid/preflight | Sendeplan-Vorabprüfung der nächsten Stunden
POST /stations/:sid/jobs | Zeitgesteuerte Aufgabe anlegen
DELETE /stations/:sid/jobs/:id | Zeitgesteuerte Aufgabe löschen
GET /stations/:sid/news | Nachrichten- und Wetter-Einstellungen lesen
PATCH /stations/:sid/news | Nachrichten- und Wetter-Einstellungen ändern
POST /stations/:sid/news/:id/fetch | Nachrichten oder Wetter jetzt abrufen
GET /stations/:sid/news/:id/file | Abgerufene Nachrichten- oder Wetter-Audiodatei laden
GET /stations/:sid/showprep/feeds | Sendungsvorbereitung: Quellen (Feeds) auflisten
POST /stations/:sid/showprep/feeds | Sendungsvorbereitung: Quelle hinzufügen
DELETE /stations/:sid/showprep/feeds/:id | Sendungsvorbereitung: Quelle entfernen
POST /stations/:sid/showprep/feeds/reset | Sendungsvorbereitung: Quellen zurücksetzen
GET /stations/:sid/showprep/articles | Sendungsvorbereitung: aktuelle Artikel
GET /stations/:sid/showprep/weather | Sendungsvorbereitung: Wetter
POST /stations/:sid/showprep/notes | Sendungsvorbereitung: KI-Moderationsnotizen erzeugen
POST /stations/:sid/news/:id/air | Nachrichten oder Wetter sofort senden
POST /stations/:sid/clock-events | Uhr-Ereignis (stündlich) anlegen
PATCH /stations/:sid/clock-events/:id | Uhr-Ereignis ändern
DELETE /stations/:sid/clock-events/:id | Uhr-Ereignis löschen
POST /stations/:sid/clock-events/:id/fire | Uhr-Ereignis sofort auslösen
POST /stations/:sid/plans | Sendeplan-Eintrag anlegen
PATCH /stations/:sid/plans/:id | Sendeplan-Eintrag ändern
DELETE /stations/:sid/plans/:id | Sendeplan-Eintrag löschen
GET /stations/:sid/recordings | Mitschnitte auflisten
POST /stations/:sid/recorder/start | Aufnahme starten
POST /stations/:sid/recorder/stop | Aufnahme beenden
GET /stations/:sid/recordings/:id/file | Mitschnitt laden
DELETE /stations/:sid/recordings/:id | Mitschnitt löschen
POST /stations/:sid/rec-plans | Automatische Aufnahme (Zeitfenster) anlegen
DELETE /stations/:sid/rec-plans/:id | Automatische Aufnahme löschen
GET /stations/:sid/podcast | Podcast: Einstellungen, Episoden, Hoster, Feed-Adresse
PUT /stations/:sid/podcast | Podcast-Einstellungen speichern (inkl. öffentliche Adresse, Auto-Veröffentlichung)
PUT /stations/:sid/podcast/cover | Podcast-Cover hochladen
POST /stations/:sid/podcast/episodes | Episode aus einem Mitschnitt anlegen
PATCH /stations/:sid/podcast/episodes/:id | Episode ändern oder veröffentlichen
PUT /stations/:sid/podcast/host | Podcast-Hoster (Buzzsprout, Podbean) einrichten oder entfernen
POST /stations/:sid/podcast/host/test | Zugangsdaten beim Podcast-Hoster prüfen
POST /stations/:sid/podcast/check | Erreichbarkeit der öffentlichen Feed-Adresse prüfen
POST /stations/:sid/podcast/episodes/:id/push | Episode zum Podcast-Hoster hochladen
DELETE /stations/:sid/podcast/episodes/:id | Episode löschen
GET /stations/:sid/stats | Hörerstatistik (period=24h, 7d, 30d …)
GET /stations/:sid/stats/deep | Tiefe Hörerstatistik
GET /stations/:sid/stats/deep.csv | Tiefe Hörerstatistik als CSV
POST /stations/:sid/stats/deep/email | Tiefe Hörerstatistik per E-Mail senden
GET /stations/:sid/recap | Sendungs-Rückblick lesen
GET /stations/:sid/recap.csv | Sendungs-Rückblick als CSV
POST /stations/:sid/recap/email | Sendungs-Rückblick per E-Mail senden
GET /stations/:sid/motion-mix/presets | Motion-Mix-Voreinstellungen auflisten
GET /stations/:sid/motion-mix/jobs | Motion-Mix-Aufträge auflisten
POST /stations/:sid/motion-mix/jobs | Motion-Mix-Auftrag starten
DELETE /stations/:sid/motion-mix/jobs/:id | Motion-Mix-Auftrag löschen
GET /stations/:sid/motion-mix/jobs/:id/file | Fertigen Motion-Mix laden
GET /storage | Speicher-Einstellungen lesen (lokal, Datenbank, Cloud)
PUT /storage | Speicher-Einstellungen speichern
POST /storage/sync | Speicher jetzt abgleichen
GET /update | Update-Status lesen
GET /update/settings | Update-Einstellungen lesen
PUT /update/settings | Update-Einstellungen speichern
POST /update/install | Verfügbares Update installieren
GET /update/apk | Android-Update-Informationen lesen
GET /stations/:sid/bridges | Brücken zu Icecast/AzuraCast/laut.fm auflisten
POST /stations/:sid/bridges | Brücke anlegen
PATCH /stations/:sid/bridges/:id | Brücke ändern
DELETE /stations/:sid/bridges/:id | Brücke löschen
GET /bridge/mappings | Brücken-Zuordnungen lesen
PUT /bridge/stations/:key | Brücken-Zuordnung eines externen Senders setzen
POST /bridge/stations/:key/now-playing | Aktuellen Titel über die Brücke einliefern
GET /bridge/stations/:key/now-playing | Aktuellen Titel über die Brücke lesen
GET /stations/:sid/liquidsoap | Liquidsoap-Konfiguration erzeugen
GET /dsp/presets | Klangbearbeitungs-Voreinstellungen auflisten
GET /stations/:sid/media/loudness | Lautheit der Bibliothek lesen
GET /stations/:sid/media/tuev | Technische Prüfung (TÜV) der Bibliothek
GET /stations/:sid/media/tuev.csv | Technische Prüfung (TÜV) als CSV
POST /stations/:sid/media/:id/key | Tonart eines Titels bestimmen
GET /stations/:sid/media/:id/lookup | Gespeicherte Online-Metadaten eines Titels lesen
POST /stations/:sid/media/:id/lookup | Metadaten eines Titels online nachschlagen
POST /stations/:sid/media/loudness | Lautheit der Bibliothek messen
GET /nextcloud | Nextcloud-Verbindung lesen
PUT /nextcloud | Nextcloud-Verbindung speichern
GET /nextcloud/list | Nextcloud-Ordner auflisten
POST /stations/:sid/nextcloud/import | Datei aus Nextcloud in die Bibliothek importieren
POST /stations/:sid/recordings/:id/nextcloud | Mitschnitt nach Nextcloud kopieren
POST /system/shutdown | Server beenden
GET /app/connect | Verbindungsdaten für Apps (Adresse, QR-Inhalt)
POST /pairing | Kopplungscode für ein neues Gerät erzeugen
GET /devices | Gekoppelte Geräte auflisten
GET /stations/:sid/inbox | Hörer-Nachrichten und Wünsche (Posteingang)
POST /stations/:sid/inbox/:id/:action | Nachricht bearbeiten: read, star, queue, delete
GET /stations/:sid/inbox/:id/audio | Sprachnachricht abspielen
GET /stations/:sid/polls | Umfragen auflisten
POST /stations/:sid/polls | Umfrage anlegen
PATCH /stations/:sid/polls/:id | Umfrage ändern oder schließen
DELETE /stations/:sid/polls/:id | Umfrage löschen
GET /stations/:sid/polls/:id/csv | Umfrageergebnis als CSV
GET /stations/:sid/forms | Formulare auflisten
POST /stations/:sid/forms | Formular anlegen
PATCH /stations/:sid/forms/:id | Formular ändern
DELETE /stations/:sid/forms/:id | Formular löschen
GET /stations/:sid/forms/:id/entries | Formulareinträge lesen
GET /stations/:sid/forms/:id/entries/csv | Formulareinträge als CSV
DELETE /stations/:sid/form-entries/:id | Formulareintrag löschen
POST /stations/:sid/draw | Auslosung durchführen
GET /stations/:sid/draws | Auslosungsprotokoll lesen
DELETE /stations/:sid/draws | Auslosungsprotokoll leeren
GET /stations/:sid/draws/csv | Auslosungsprotokoll als CSV
GET /stations/:sid/listener | Einstellungen des Hörerbereichs lesen
PUT /stations/:sid/listener | Einstellungen des Hörerbereichs speichern
GET /setup | Einrichtungs-Assistent: Stand lesen
POST /setup/installer-welcome/ack | Willkommensseite des Installers bestätigen
PUT /setup/:step | Einrichtungsschritt speichern
POST /system/restart | Server neu starten
GET /discover | Server im lokalen Netz finden
GET /backup | Sicherungen auflisten
POST /backup | Sicherung erstellen
POST /backup/:file/restore | Sicherung wiederherstellen
GET /stations/:sid/folders/linked | Verknüpfte Ordner lesen
POST /stations/:sid/folders/linked | Ordner verknüpfen
POST /stations/:sid/folders/linked/scan | Verknüpfte Ordner einlesen
DELETE /stations/:sid/folders/linked | Ordner-Verknüpfung lösen
DELETE /devices/:id | Gekoppeltes Gerät entfernen
PUT /app/network | Netzwerk-Einstellungen (Port, Zugriff von außen) setzen
GET /app/origins | Erlaubte Web-Herkunftsadressen (CORS) lesen
PUT /app/origins | Erlaubte Web-Herkunftsadressen (CORS) setzen
GET /app/remote-link | Fernzugriffs-Link lesen
PUT /app/remote-link | Fernzugriffs-Link einrichten
DELETE /app/remote-link | Fernzugriffs-Link entfernen
GET /ai/settings | KI-Anbieter und Einstellungen lesen
PUT /ai/settings | KI-Anbieter und Einstellungen speichern
GET /ai/usage | KI-Nutzung lesen
GET /ai/health | KI-Anbieter prüfen
POST /ai/providers/:id/release | Lokalen KI-Anbieter aus dem Speicher entladen
GET /ai/providers/:id/models | Modelle eines KI-Anbieters auflisten
GET /ai/providers/:id/voices | Stimmen eines KI-Anbieters auflisten
POST /ai/discover | Lokale KI-Server (Ollama, LM Studio …) auf diesem PC/Server oder einem Rechner im Netz suchen
GET /stations/:sid/ai | KI-Einstellungen des Senders lesen
PUT /stations/:sid/ai | KI-Einstellungen des Senders speichern
POST /stations/:sid/ai/moderation | KI-Moderation erzeugen (Text und Sprache)
POST /stations/:sid/ai/music | KI-Musik erzeugen
POST /stations/:sid/ai/pending/:id/approve | KI-Ergebnis freigeben
POST /stations/:sid/ai/pending/:id/reject | KI-Ergebnis verwerfen
POST /stations/:sid/ai/text | KI-Text erzeugen
POST /stations/:sid/ai/speech | Text in Sprache umwandeln
GET /stations/:sid/ai/chat | KI-Assistent: Verlauf lesen
DELETE /stations/:sid/ai/chat | KI-Assistent: Verlauf löschen
POST /stations/:sid/ai/chat | KI-Assistent: Nachricht senden
POST /stations/:sid/ai/improve | KI: Text verbessern
POST /stations/:sid/ai/rewrite | KI: Text umschreiben
POST /stations/:sid/ai/spot-mix | KI-Spot-Werkstatt: Sprache mit Musikbett mischen
POST /stations/:sid/ai/plan | KI: Sendeplan vorschlagen
POST /stations/:sid/ai/transcribe | Sprache in Text umwandeln (Transkription)
GET /stations/:sid/ai/studio | KI-Studio: Voreinstellungen und Verlauf lesen
POST /stations/:sid/ai/studio/write | KI-Studio: Text schreiben (Art und Ton wählbar)
POST /stations/:sid/ai/studio/playlist | KI-Studio: Playlist vorschlagen
GET /stations/:sid/integrations | Integrationen (Webhooks, E-Mail, Benachrichtigungen) lesen
PUT /stations/:sid/integrations | Integrationen speichern
POST /stations/:sid/integrations/test | Integration testen
GET /stations/:sid/lautfm | laut.fm-Anbindung lesen
PUT /stations/:sid/lautfm | laut.fm-Anbindung speichern
POST /stations/:sid/lautfm/connect | Mit laut.fm verbinden
POST /stations/:sid/lautfm/check | laut.fm-Anbindung prüfen
POST /stations/:sid/lautfm/live-output | laut.fm-Live-Ausgang einrichten
POST /stations/:sid/lautfm/relay-output | laut.fm-Relay-Ausgang einrichten
GET /stations/:sid/cardwall | Cardwall (Jingle- und Spot-Tasten) lesen
PATCH /stations/:sid/cardwall/:slot | Cardwall-Taste belegen
POST /stations/:sid/cardwall/:slot/trigger | Cardwall-Taste auslösen
GET /events | Live-Ereignisse als Server-Sent Events (?station=…)
`;
