# AnMaCha Cast – API-Referenz

Vollständige Liste aller Endpunkte (Version 0.5.0, 348 Endpunkte). Diese Datei wird aus dem laufenden Code erzeugt (`npm run docs:api`);
die maschinenlesbare Fassung ist [openapi.json](openapi.json) (OpenAPI 3.1), live unter `/api/v1/openapi.json`, interaktiv unter `/api-docs.html`.
Einführung, Anmeldung, Rechte und Beispiele: [API.md](API.md).

„Recht“ nennt den Scope, den der Schlüssel braucht. `Sitzung` = jede Anmeldung genügt (zusätzliche Prüfungen, z. B. Administrator, macht der Server). `–` = ohne Anmeldung.

## Konto & Zugang

Anmeldung, Benutzer, Rollen, API-Schlüssel, Geräte-Kopplung.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/audit` | `audit:read` | Audit-Protokoll lesen |
| POST | `/api/v1/auth/login` | – | Anmelden: { username, password } liefert Sitzungs-Token und Benutzer |
| POST | `/api/v1/auth/logout` | Sitzung | Sitzung beenden |
| POST | `/api/v1/auth/password` | Sitzung | Eigenes Passwort ändern |
| GET | `/api/v1/auth/status` | – | Gibt an, ob Benutzerkonten existieren und Kopplung möglich ist |
| GET | `/api/v1/capabilities` | Sitzung | Fähigkeiten dieses Servers (Ausgabearten, Engine, Funktionen) |
| GET | `/api/v1/me` | Sitzung | Eigene Identität: Rollen, Rechte, erlaubte Sender |
| GET | `/api/v1/me/profile` | Sitzung | Eigenes Profil lesen |
| PATCH | `/api/v1/me/profile` | Sitzung | Eigenes Profil ändern (Name, Links) |
| GET | `/api/v1/me/tokens` | Sitzung | Eigene API-Schlüssel auflisten |
| POST | `/api/v1/me/tokens` | Sitzung | Eigenen API-Schlüssel erzeugen (Klartext nur in dieser Antwort) |
| DELETE | `/api/v1/me/tokens/:id` | Sitzung | Eigenen API-Schlüssel widerrufen |
| GET | `/api/v1/tokens` | `tokens:write` | Alle API-Schlüssel auflisten (Administrator) |
| POST | `/api/v1/tokens` | `tokens:write` | Sender-unabhängigen API-Schlüssel erzeugen (Administrator) |
| DELETE | `/api/v1/tokens/:id` | `tokens:write` | API-Schlüssel widerrufen (Administrator) |
| GET | `/api/v1/users` | Sitzung | Benutzer auflisten (Administrator) |
| POST | `/api/v1/users` | Sitzung | Benutzer anlegen (Administrator) |
| PATCH | `/api/v1/users/:id` | Sitzung | Benutzer ändern: Rolle, Sender, Sperre, Passwort (Administrator) |
| DELETE | `/api/v1/users/:id` | Sitzung | Benutzer löschen (Administrator) |

## Apps & Geräte

Verbindung der Apps (Android, Windows): Kopplung, Server finden, Verbindungsdaten, Updates.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/app/connect` | Sitzung | Verbindungsdaten für Apps (Adresse, QR-Inhalt) |
| GET | `/api/v1/devices` | `tokens:write` | Gekoppelte Geräte auflisten |
| DELETE | `/api/v1/devices/:id` | `tokens:write` | Gekoppeltes Gerät entfernen |
| GET | `/api/v1/discover` | Sitzung | Server im lokalen Netz finden |
| POST | `/api/v1/pair` | – | Kopplungscode einlösen: { code, name, platform } liefert den Geräte-Token (Apps) |
| POST | `/api/v1/pairing` | `tokens:write` | Kopplungscode für ein neues Gerät erzeugen |

## Sender

Sender anlegen, ändern, Senderverbund.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/network` | `branding:read` | Senderverbund: alle sichtbaren Sender mit Status |
| GET | `/api/v1/stations` | `branding:read` | Sender auflisten |
| POST | `/api/v1/stations` | `stations:write` | Sender anlegen |
| GET | `/api/v1/stations/:sid` | `branding:read` | Sender lesen |
| PATCH | `/api/v1/stations/:sid` | `stations:write` | Sender ändern (Name, Slogan, Genre, Farbe, öffentlich) |
| DELETE | `/api/v1/stations/:sid` | `stations:write` | Sender löschen |
| GET | `/api/v1/stations/:sid/logo` | – | Sender-Logo als Bild |
| PUT | `/api/v1/stations/:sid/logo` | `stations:write` | Sender-Logo hochladen (Bilddaten, höchstens 2 MB) |
| DELETE | `/api/v1/stations/:sid/logo` | `stations:write` | Sender-Logo entfernen |

## Quellen & Live

Live-Eingänge, Relays, Übernahme, Browser-/App-Live-Übertragung.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/sources` | `sources:read` | Quellen auflisten (Live-Eingänge, Relays) |
| POST | `/api/v1/stations/:sid/sources` | `sources:write` | Quelle anlegen |
| PATCH | `/api/v1/stations/:sid/sources/:id` | `sources:write` | Quelle ändern |
| DELETE | `/api/v1/stations/:sid/sources/:id` | `sources:write` | Quelle löschen |
| POST | `/api/v1/stations/:sid/sources/:id/chunks` | `sources:write` | Audio-Häppchen einer Quelle senden (Browser-/App-Live-Übertragung) |
| POST | `/api/v1/stations/:sid/sources/:id/health` | `sources:write` | Gesundheitszustand einer Quelle melden |
| POST | `/api/v1/stations/:sid/sources/:id/password` | `sources:write` | Zugangspasswort einer Quelle neu erzeugen |
| POST | `/api/v1/stations/:sid/sources/:id/release` | `sources:write` | Live-Übernahme beenden |
| POST | `/api/v1/stations/:sid/sources/:id/takeover` | `sources:write` | Live-Übernahme durch diese Quelle |

## Ausgänge & Streams

Icecast/Shoutcast/laut.fm-Ausgänge, Zusatz-Streams, Stream-Profile, Liquidsoap.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/dsp/presets` | `automation:read` | Klangbearbeitungs-Voreinstellungen auflisten |
| GET | `/api/v1/stations/:sid/liquidsoap` | `outputs:read` | Liquidsoap-Konfiguration erzeugen |
| GET | `/api/v1/stations/:sid/outputs` | `outputs:read` | Ausgänge auflisten (Icecast, Shoutcast, laut.fm …) |
| POST | `/api/v1/stations/:sid/outputs` | `outputs:write` | Ausgang anlegen |
| PATCH | `/api/v1/stations/:sid/outputs/:id` | `outputs:write` | Ausgang ändern oder ein-/ausschalten |
| DELETE | `/api/v1/stations/:sid/outputs/:id` | `outputs:write` | Ausgang löschen |
| GET | `/api/v1/stations/:sid/own-streams` | `outputs:read` | Eigene Zusatz-Streams mit Zeitfenstern auflisten |
| POST | `/api/v1/stations/:sid/own-streams` | `outputs:write` | Zusatz-Stream anlegen |
| PATCH | `/api/v1/stations/:sid/own-streams/:id` | `outputs:write` | Zusatz-Stream ändern |
| DELETE | `/api/v1/stations/:sid/own-streams/:id` | `outputs:write` | Zusatz-Stream löschen |
| GET | `/api/v1/stations/:sid/stream-profiles` | `outputs:read` | Stream-Profile (Codec, Bitrate) auflisten |
| POST | `/api/v1/stations/:sid/stream-profiles` | `outputs:write` | Stream-Profil anlegen |
| POST | `/api/v1/stations/:sid/stream-profiles-test` | `automation:write` | Stream-Profil testen |
| PATCH | `/api/v1/stations/:sid/stream-profiles/:id` | `outputs:write` | Stream-Profil ändern |
| DELETE | `/api/v1/stations/:sid/stream-profiles/:id` | `outputs:write` | Stream-Profil löschen |

## Bibliothek

Titel hochladen, suchen, bearbeiten, Wellenform, Voice Studio, Lautheit, Prüfungen.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/audio-devices` | `automation:read` | Audio-Geräte des Servers auflisten |
| GET | `/api/v1/stations/:sid/folders` | `media:read` | Überwachte Ordner der Bibliothek auflisten |
| GET | `/api/v1/stations/:sid/folders/linked` | `media:read` | Verknüpfte Ordner lesen |
| POST | `/api/v1/stations/:sid/folders/linked` | Sitzung | Ordner verknüpfen |
| DELETE | `/api/v1/stations/:sid/folders/linked` | Sitzung | Ordner-Verknüpfung lösen |
| POST | `/api/v1/stations/:sid/folders/linked/scan` | Sitzung | Verknüpfte Ordner einlesen |
| GET | `/api/v1/stations/:sid/media` | `media:read` | Bibliothek durchsuchen (q, category, limit) |
| PUT | `/api/v1/stations/:sid/media` | `media:write` | Audiodatei hochladen (Rohdaten im Body, ?name=Titel.mp3) |
| PATCH | `/api/v1/stations/:sid/media/:id` | `media:write` | Titel-Metadaten ändern (Titel, Interpret, Kategorie, Tags) |
| DELETE | `/api/v1/stations/:sid/media/:id` | `media:write` | Titel löschen |
| GET | `/api/v1/stations/:sid/media/:id/cover` | `media:read` | Cover-Bild eines Titels laden |
| GET | `/api/v1/stations/:sid/media/:id/file` | `media:read` | Audiodatei laden (mit Range-Unterstützung) |
| POST | `/api/v1/stations/:sid/media/:id/key` | `media:write` | Tonart eines Titels bestimmen |
| GET | `/api/v1/stations/:sid/media/:id/lookup` | `media:read` | Gespeicherte Online-Metadaten eines Titels lesen |
| POST | `/api/v1/stations/:sid/media/:id/lookup` | `media:write` | Metadaten eines Titels online nachschlagen |
| POST | `/api/v1/stations/:sid/media/:id/relink` | `media:write` | Fehlende Datei eines Titels neu verknüpfen |
| POST | `/api/v1/stations/:sid/media/:id/voice-edit` | `media:write` | Voice Studio: Titel schneiden und aufbereiten (Vorschau oder neuer Titel) |
| GET | `/api/v1/stations/:sid/media/:id/waveform` | `media:read` | Wellenform eines Titels (600 Spitzenwerte) |
| GET | `/api/v1/stations/:sid/media/integrity` | `media:read` | Bibliothek auf fehlende Dateien prüfen |
| GET | `/api/v1/stations/:sid/media/loudness` | `media:read` | Lautheit der Bibliothek lesen |
| POST | `/api/v1/stations/:sid/media/loudness` | `media:write` | Lautheit der Bibliothek messen |
| GET | `/api/v1/stations/:sid/media/tuev` | `media:read` | Technische Prüfung (TÜV) der Bibliothek |
| GET | `/api/v1/stations/:sid/media/tuev.csv` | `media:read` | Technische Prüfung (TÜV) als CSV |
| POST | `/api/v1/stations/:sid/media/url` | `media:write` | Audiodatei von einer Adresse laden |

## MusicHub

Senderübergreifender Austausch von Titeln, Jingles und Dokumenten.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/music-hub/:kind/:id/grants` | `media:write` | MusicHub: Freigaben eines Eintrags oder einer Sammlung lesen |
| POST | `/api/v1/music-hub/:kind/:id/grants` | `media:write` | MusicHub: Freigabe an einen Sender erteilen |
| GET | `/api/v1/music-hub/collections` | `media:read` | MusicHub: Sammlungen auflisten |
| POST | `/api/v1/music-hub/collections` | `media:write` | MusicHub: Sammlung anlegen |
| PUT | `/api/v1/music-hub/collections/:id/items` | `media:write` | MusicHub: Inhalt einer Sammlung setzen |
| DELETE | `/api/v1/music-hub/grants/:id` | `media:write` | MusicHub: Freigabe widerrufen |
| GET | `/api/v1/music-hub/items` | `media:read` | MusicHub: Einträge auflisten |
| POST | `/api/v1/music-hub/items` | `media:write` | MusicHub: Eintrag aus der eigenen Bibliothek anlegen |
| DELETE | `/api/v1/music-hub/items/:id` | `media:write` | MusicHub: Eintrag löschen |
| GET | `/api/v1/music-hub/items/:id/cover` | `media:read` | MusicHub: Cover-Bild laden |
| GET | `/api/v1/music-hub/items/:id/download` | `media:read` | MusicHub: Datei herunterladen |
| GET | `/api/v1/music-hub/items/:id/lautcast-capability` | `media:read` | MusicHub: Eignung für laut.fm-Übertragung prüfen |
| POST | `/api/v1/music-hub/items/:id/lautcast-transfer` | `media:write` | MusicHub: Eintrag zu laut.fm übertragen |
| GET | `/api/v1/music-hub/items/:id/preflight` | `media:read` | MusicHub: Vorabprüfung (Format, Länge, Lautheit) |
| GET | `/api/v1/music-hub/items/:id/preview` | `media:read` | MusicHub: Vorschau-Audio laden |
| PUT | `/api/v1/music-hub/items/:id/replace` | `media:write` | MusicHub: Datei eines Eintrags ersetzen |
| POST | `/api/v1/music-hub/items/:id/stage` | `media:write` | MusicHub: Eintrag in die eigene Bibliothek übernehmen |
| GET | `/api/v1/music-hub/recipients` | `media:write` | MusicHub: mögliche Empfänger-Sender auflisten |
| GET | `/api/v1/music-hub/transfers` | `media:write` | MusicHub: Übertragungen auflisten |
| PUT | `/api/v1/music-hub/uploads` | `media:write` | MusicHub: Datei in den Hub hochladen |
| GET | `/api/v1/music-hub/uploads/quota` | `media:write` | MusicHub: Upload-Kontingent lesen |

## Nextcloud

Dateien aus Nextcloud importieren, Mitschnitte dorthin kopieren.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/music-hub/nextcloud` | `media:write` | MusicHub: Nextcloud-Verbindung lesen |
| PUT | `/api/v1/music-hub/nextcloud` | `media:write` | MusicHub: Nextcloud-Verbindung speichern |
| POST | `/api/v1/music-hub/nextcloud/import` | `media:write` | MusicHub: Datei aus Nextcloud importieren |
| POST | `/api/v1/music-hub/nextcloud/import-folder` | `media:write` | MusicHub: Ordner aus Nextcloud importieren |
| POST | `/api/v1/music-hub/nextcloud/import-folder-job` | `media:write` | MusicHub: Ordner-Import als Hintergrundauftrag starten |
| GET | `/api/v1/music-hub/nextcloud/jobs` | `media:write` | MusicHub: Nextcloud-Aufträge auflisten |
| POST | `/api/v1/music-hub/nextcloud/jobs/:id/restart` | `media:write` | MusicHub: Nextcloud-Auftrag neu starten |
| GET | `/api/v1/music-hub/nextcloud/list` | `media:write` | MusicHub: Nextcloud-Ordner auflisten |
| GET | `/api/v1/nextcloud` | Sitzung | Nextcloud-Verbindung lesen |
| PUT | `/api/v1/nextcloud` | Sitzung | Nextcloud-Verbindung speichern |
| GET | `/api/v1/nextcloud/list` | `media:read` | Nextcloud-Ordner auflisten |
| POST | `/api/v1/stations/:sid/nextcloud/import` | `media:write` | Datei aus Nextcloud in die Bibliothek importieren |
| POST | `/api/v1/stations/:sid/recordings/:id/nextcloud` | `media:write` | Mitschnitt nach Nextcloud kopieren |

## Warteschlange & Playlists

Warteschlange, Playlists, Smart-Blöcke, Rotation, Playlist-Lifehacks.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/lifehacks/analyze/:id` | `queue:read` | Playlist-Lifehacks: Playlist analysieren |
| GET | `/api/v1/stations/:sid/lifehacks/compare` | `queue:read` | Playlist-Lifehacks: Playlists vergleichen |
| POST | `/api/v1/stations/:sid/lifehacks/delete-many` | `queue:write` | Playlist-Lifehacks: viele Titel löschen |
| POST | `/api/v1/stations/:sid/lifehacks/fill-year` | `media:write` | Playlist-Lifehacks: fehlende Erscheinungsjahre ergänzen |
| GET | `/api/v1/stations/:sid/lifehacks/find` | `media:read` | Playlist-Lifehacks: Titel finden |
| GET | `/api/v1/stations/:sid/lifehacks/health` | `queue:read` | Playlist-Lifehacks: Gesundheitsprüfung der Bibliothek |
| POST | `/api/v1/stations/:sid/lifehacks/mass-tag` | `media:write` | Playlist-Lifehacks: Tags für viele Titel setzen |
| POST | `/api/v1/stations/:sid/lifehacks/merge` | `queue:write` | Playlist-Lifehacks: Playlists zusammenführen |
| GET | `/api/v1/stations/:sid/lifehacks/runtime/:id` | `queue:read` | Playlist-Lifehacks: Laufzeit einer Playlist |
| POST | `/api/v1/stations/:sid/lifehacks/top-tracks` | `queue:write` | Playlist-Lifehacks: Top-Titel in eine Playlist |
| POST | `/api/v1/stations/:sid/m3u/import` | `queue:write` | M3U-Liste als Playlist importieren |
| GET | `/api/v1/stations/:sid/playlists` | `queue:read` | Playlists auflisten |
| POST | `/api/v1/stations/:sid/playlists` | `queue:write` | Playlist anlegen |
| PATCH | `/api/v1/stations/:sid/playlists/:id` | `queue:write` | Playlist ändern (Name, Titel) |
| DELETE | `/api/v1/stations/:sid/playlists/:id` | `queue:write` | Playlist löschen |
| POST | `/api/v1/stations/:sid/playlists/:id/play` | `automation:write` | Playlist sofort spielen |
| POST | `/api/v1/stations/:sid/playlists/:id/shuffle` | `queue:write` | Playlist mischen |
| GET | `/api/v1/stations/:sid/queue` | `queue:read` | Warteschlange lesen |
| POST | `/api/v1/stations/:sid/queue` | `queue:write` | Titel einreihen: { mediaId, index? } |
| GET | `/api/v1/stations/:sid/queue.m3u` | `queue:read` | Warteschlange als M3U-Datei |
| DELETE | `/api/v1/stations/:sid/queue/:uid` | `queue:write` | Eintrag aus der Warteschlange entfernen |
| POST | `/api/v1/stations/:sid/queue/:uid/move` | `queue:write` | Eintrag in der Warteschlange verschieben |
| POST | `/api/v1/stations/:sid/queue/clear` | `queue:write` | Warteschlange leeren |
| POST | `/api/v1/stations/:sid/queue/fill` | `queue:write` | Warteschlange aus der Rotation auffüllen |
| POST | `/api/v1/stations/:sid/queue/fill-from` | `queue:write` | Warteschlange aus einer Playlist auffüllen |
| POST | `/api/v1/stations/:sid/queue/next` | `queue:write` | Nächsten Titel aus der Rotation nachlegen |
| POST | `/api/v1/stations/:sid/queue/shuffle` | `queue:write` | Warteschlange mischen |
| GET | `/api/v1/stations/:sid/rotation-pool` | `queue:read` | Rotationspool lesen |
| PUT | `/api/v1/stations/:sid/rotation-pool` | `automation:write` | Rotationspool setzen |
| GET | `/api/v1/stations/:sid/smart-blocks` | `queue:read` | Smart-Blöcke (regelbasierte Titelauswahl) auflisten |
| POST | `/api/v1/stations/:sid/smart-blocks` | `queue:write` | Smart-Block anlegen |
| PATCH | `/api/v1/stations/:sid/smart-blocks/:id` | `queue:write` | Smart-Block ändern |
| DELETE | `/api/v1/stations/:sid/smart-blocks/:id` | `queue:write` | Smart-Block löschen |
| POST | `/api/v1/stations/:sid/smart-blocks/:id/playlist` | `queue:write` | Aus einem Smart-Block eine Playlist erzeugen |
| POST | `/api/v1/stations/:sid/smart-blocks/preview` | `queue:read` | Smart-Block-Auswahl vorab berechnen |

## Playout & Decks

Automation, Decks A–D, Cardwall, Betriebsart, aktueller Titel, Verlauf.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/automation` | `automation:read` | Automationseinstellungen lesen |
| PATCH | `/api/v1/stations/:sid/automation` | `automation:write` | Automationseinstellungen ändern |
| GET | `/api/v1/stations/:sid/automation-source` | `now_playing:read` | Quelle der Automation erkennen (AnMaCha Cast oder laut.fm) |
| GET | `/api/v1/stations/:sid/cardwall` | `cardwall:read` | Cardwall (Jingle- und Spot-Tasten) lesen |
| PATCH | `/api/v1/stations/:sid/cardwall/:slot` | `automation:write` | Cardwall-Taste belegen |
| POST | `/api/v1/stations/:sid/cardwall/:slot/trigger` | `cardwall:trigger` | Cardwall-Taste auslösen |
| GET | `/api/v1/stations/:sid/decks` | `automation:read` | Deck-Zustand lesen (A bis D) |
| PUT | `/api/v1/stations/:sid/decks/:deck` | `automation:write` | Deck mit einem Titel beladen |
| POST | `/api/v1/stations/:sid/decks/:deck/:action` | `automation:write` | Deck bedienen: load, play, pause, stop, eject, seek, tempo, loop, advance |
| GET | `/api/v1/stations/:sid/history` | `now_playing:read` | Verlauf der gespielten Titel |
| POST | `/api/v1/stations/:sid/metadata` | `automation:write` | Titelanzeige für die Ausgänge senden: { artist, title } |
| GET | `/api/v1/stations/:sid/mode` | `automation:read` | Betriebsart lesen (auto oder live) |
| PUT | `/api/v1/stations/:sid/mode` | `automation:write` | Betriebsart setzen (auto oder live) |
| GET | `/api/v1/stations/:sid/now-playing` | `now_playing:read` | Aktueller Titel mit Dauer, Position und nächstem Titel |
| POST | `/api/v1/stations/:sid/now-playing` | `automation:write` | Titel aus der Bibliothek als laufend setzen: { mediaId, deck } |
| POST | `/api/v1/stations/:sid/onair` | `automation:write` | On-Air-Status setzen |
| GET | `/api/v1/stations/:sid/playout` | `automation:read` | Playout-Zustand lesen (Lautstärke, Überblendung, Mikrofon) |
| PATCH | `/api/v1/stations/:sid/playout` | `automation:write` | Playout-Einstellungen ändern |
| POST | `/api/v1/stations/:sid/playout/carts-stop` | `cardwall:trigger` | Alle Carts stoppen |
| POST | `/api/v1/stations/:sid/playout/loop-advance` | `cardwall:trigger` | Endlos-Schleife zum nächsten Titel weiterschalten |
| POST | `/api/v1/stations/:sid/playout/mic` | `automation:write` | Mikrofon (Ducking) ein- oder ausschalten |
| POST | `/api/v1/stations/:sid/playout/skip` | `automation:write` | Aktuellen Titel überspringen |
| POST | `/api/v1/stations/:sid/playout/start` | `automation:write` | Automation starten |
| POST | `/api/v1/stations/:sid/playout/stop` | `automation:write` | Automation stoppen |
| POST | `/api/v1/stations/:sid/quick/:category` | `cardwall:trigger` | Zufälligen Jingle oder Spot einer Kategorie spielen |

## Planung & Aufnahme

Sendeplan, Uhr-Ereignisse, Aufgaben, Recorder und Mitschnitte.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| POST | `/api/v1/stations/:sid/clock-events` | `automation:write` | Uhr-Ereignis (stündlich) anlegen |
| PATCH | `/api/v1/stations/:sid/clock-events/:id` | `automation:write` | Uhr-Ereignis ändern |
| DELETE | `/api/v1/stations/:sid/clock-events/:id` | `automation:write` | Uhr-Ereignis löschen |
| POST | `/api/v1/stations/:sid/clock-events/:id/fire` | `automation:write` | Uhr-Ereignis sofort auslösen |
| POST | `/api/v1/stations/:sid/jobs` | `automation:write` | Zeitgesteuerte Aufgabe anlegen |
| DELETE | `/api/v1/stations/:sid/jobs/:id` | `automation:write` | Zeitgesteuerte Aufgabe löschen |
| GET | `/api/v1/stations/:sid/planning` | `schedule:read` | Planung: Sendeplan, Uhr-Ereignisse, Aufgaben |
| POST | `/api/v1/stations/:sid/plans` | `automation:write` | Sendeplan-Eintrag anlegen |
| PATCH | `/api/v1/stations/:sid/plans/:id` | `automation:write` | Sendeplan-Eintrag ändern |
| DELETE | `/api/v1/stations/:sid/plans/:id` | `automation:write` | Sendeplan-Eintrag löschen |
| GET | `/api/v1/stations/:sid/preflight` | `schedule:read` | Sendeplan-Vorabprüfung der nächsten Stunden |
| POST | `/api/v1/stations/:sid/rec-plans` | `automation:write` | Automatische Aufnahme (Zeitfenster) anlegen |
| DELETE | `/api/v1/stations/:sid/rec-plans/:id` | `automation:write` | Automatische Aufnahme löschen |
| POST | `/api/v1/stations/:sid/recorder/start` | `automation:write` | Aufnahme starten |
| POST | `/api/v1/stations/:sid/recorder/stop` | `automation:write` | Aufnahme beenden |
| GET | `/api/v1/stations/:sid/recordings` | `automation:read` | Mitschnitte auflisten |
| DELETE | `/api/v1/stations/:sid/recordings/:id` | `automation:write` | Mitschnitt löschen |
| GET | `/api/v1/stations/:sid/recordings/:id/file` | `automation:read` | Mitschnitt laden |

## Nachrichten & Vorbereitung

Nachrichten, Wetter und Sendungsvorbereitung.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/news` | `media:read` | Nachrichten- und Wetter-Einstellungen lesen |
| PATCH | `/api/v1/stations/:sid/news` | `automation:write` | Nachrichten- und Wetter-Einstellungen ändern |
| POST | `/api/v1/stations/:sid/news/:id/air` | `automation:write` | Nachrichten oder Wetter sofort senden |
| POST | `/api/v1/stations/:sid/news/:id/fetch` | `automation:write` | Nachrichten oder Wetter jetzt abrufen |
| GET | `/api/v1/stations/:sid/news/:id/file` | `media:read` | Abgerufene Nachrichten- oder Wetter-Audiodatei laden |
| GET | `/api/v1/stations/:sid/showprep/articles` | `automation:read` | Sendungsvorbereitung: aktuelle Artikel |
| GET | `/api/v1/stations/:sid/showprep/feeds` | `automation:read` | Sendungsvorbereitung: Quellen (Feeds) auflisten |
| POST | `/api/v1/stations/:sid/showprep/feeds` | `automation:write` | Sendungsvorbereitung: Quelle hinzufügen |
| DELETE | `/api/v1/stations/:sid/showprep/feeds/:id` | `automation:write` | Sendungsvorbereitung: Quelle entfernen |
| POST | `/api/v1/stations/:sid/showprep/feeds/reset` | `automation:write` | Sendungsvorbereitung: Quellen zurücksetzen |
| POST | `/api/v1/stations/:sid/showprep/notes` | `ai:write` | Sendungsvorbereitung: KI-Moderationsnotizen erzeugen |
| GET | `/api/v1/stations/:sid/showprep/weather` | `automation:read` | Sendungsvorbereitung: Wetter |

## Podcast

Eigener Podcast-Feed, Episoden, öffentliche Adresse und Upload zu Buzzsprout/Podbean.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/public/stations/:sid/podcast.xml` | – | Podcast-Feed (RSS 2.0 mit iTunes-Erweiterung) |
| GET | `/api/v1/public/stations/:sid/podcast/cover` | – | Podcast-Cover |
| GET | `/api/v1/public/stations/:sid/podcast/episodes/:eid/audio` | – | Audio einer veröffentlichten Episode |
| GET | `/api/v1/stations/:sid/podcast` | `automation:read` | Podcast: Einstellungen, Episoden, Hoster, Feed-Adresse |
| PUT | `/api/v1/stations/:sid/podcast` | `automation:write` | Podcast-Einstellungen speichern (inkl. öffentliche Adresse, Auto-Veröffentlichung) |
| POST | `/api/v1/stations/:sid/podcast/check` | `automation:write` | Erreichbarkeit der öffentlichen Feed-Adresse prüfen |
| PUT | `/api/v1/stations/:sid/podcast/cover` | `automation:write` | Podcast-Cover hochladen |
| POST | `/api/v1/stations/:sid/podcast/episodes` | `automation:write` | Episode aus einem Mitschnitt anlegen |
| PATCH | `/api/v1/stations/:sid/podcast/episodes/:id` | `automation:write` | Episode ändern oder veröffentlichen |
| DELETE | `/api/v1/stations/:sid/podcast/episodes/:id` | `automation:write` | Episode löschen |
| POST | `/api/v1/stations/:sid/podcast/episodes/:id/push` | `automation:write` | Episode zum Podcast-Hoster hochladen |
| PUT | `/api/v1/stations/:sid/podcast/host` | `automation:write` | Podcast-Hoster (Buzzsprout, Podbean) einrichten oder entfernen |
| POST | `/api/v1/stations/:sid/podcast/host/test` | `automation:write` | Zugangsdaten beim Podcast-Hoster prüfen |

## Statistik

Hörerstatistik und Sendungs-Rückblick.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/recap` | `automation:read` | Sendungs-Rückblick lesen |
| GET | `/api/v1/stations/:sid/recap.csv` | `automation:read` | Sendungs-Rückblick als CSV |
| POST | `/api/v1/stations/:sid/recap/email` | `automation:write` | Sendungs-Rückblick per E-Mail senden |
| GET | `/api/v1/stations/:sid/stats` | `automation:read` | Hörerstatistik (period=24h, 7d, 30d …) |
| GET | `/api/v1/stations/:sid/stats/deep` | `automation:read` | Tiefe Hörerstatistik |
| GET | `/api/v1/stations/:sid/stats/deep.csv` | `automation:read` | Tiefe Hörerstatistik als CSV |
| POST | `/api/v1/stations/:sid/stats/deep/email` | `automation:write` | Tiefe Hörerstatistik per E-Mail senden |

## Motion Mix

Automatisch gemischte Übergänge als Aufträge.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/stations/:sid/motion-mix/jobs` | `automation:read` | Motion-Mix-Aufträge auflisten |
| POST | `/api/v1/stations/:sid/motion-mix/jobs` | `automation:write` | Motion-Mix-Auftrag starten |
| DELETE | `/api/v1/stations/:sid/motion-mix/jobs/:id` | `automation:write` | Motion-Mix-Auftrag löschen |
| GET | `/api/v1/stations/:sid/motion-mix/jobs/:id/file` | `automation:read` | Fertigen Motion-Mix laden |
| GET | `/api/v1/stations/:sid/motion-mix/presets` | `automation:read` | Motion-Mix-Voreinstellungen auflisten |

## KI

KI-Anbieter, Text, Sprache, Musik, Spot-Werkstatt, Assistent.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/ai` | `ai:read` | KI-Dienste: Übersicht über Anbieter und Zustand |
| POST | `/api/v1/ai/discover` | Sitzung | Lokale KI-Server (Ollama, LM Studio …) auf diesem PC/Server oder einem Rechner im Netz suchen |
| GET | `/api/v1/ai/health` | Sitzung | KI-Anbieter prüfen |
| GET | `/api/v1/ai/providers/:id/models` | Sitzung | Modelle eines KI-Anbieters auflisten |
| POST | `/api/v1/ai/providers/:id/release` | Sitzung | Lokalen KI-Anbieter aus dem Speicher entladen |
| GET | `/api/v1/ai/providers/:id/voices` | Sitzung | Stimmen eines KI-Anbieters auflisten |
| GET | `/api/v1/ai/settings` | Sitzung | KI-Anbieter und Einstellungen lesen |
| PUT | `/api/v1/ai/settings` | Sitzung | KI-Anbieter und Einstellungen speichern |
| GET | `/api/v1/ai/usage` | Sitzung | KI-Nutzung lesen |
| GET | `/api/v1/stations/:sid/ai` | `ai:read` | KI-Einstellungen des Senders lesen |
| PUT | `/api/v1/stations/:sid/ai` | `ai:write` | KI-Einstellungen des Senders speichern |
| GET | `/api/v1/stations/:sid/ai/chat` | `ai:read` | KI-Assistent: Verlauf lesen |
| POST | `/api/v1/stations/:sid/ai/chat` | `ai:write` | KI-Assistent: Nachricht senden |
| DELETE | `/api/v1/stations/:sid/ai/chat` | `ai:write` | KI-Assistent: Verlauf löschen |
| POST | `/api/v1/stations/:sid/ai/improve` | `ai:write` | KI: Text verbessern |
| POST | `/api/v1/stations/:sid/ai/moderation` | `ai:write` | KI-Moderation erzeugen (Text und Sprache) |
| POST | `/api/v1/stations/:sid/ai/music` | `ai:write` | KI-Musik erzeugen |
| POST | `/api/v1/stations/:sid/ai/pending/:id/approve` | `ai:write` | KI-Ergebnis freigeben |
| POST | `/api/v1/stations/:sid/ai/pending/:id/reject` | `ai:write` | KI-Ergebnis verwerfen |
| POST | `/api/v1/stations/:sid/ai/plan` | `ai:write` | KI: Sendeplan vorschlagen |
| POST | `/api/v1/stations/:sid/ai/rewrite` | `ai:write` | KI: Text umschreiben |
| POST | `/api/v1/stations/:sid/ai/speech` | `ai:write` | Text in Sprache umwandeln |
| POST | `/api/v1/stations/:sid/ai/spot-mix` | `ai:write` | KI-Spot-Werkstatt: Sprache mit Musikbett mischen |
| GET | `/api/v1/stations/:sid/ai/studio` | `ai:read` | KI-Studio: Voreinstellungen und Verlauf lesen |
| POST | `/api/v1/stations/:sid/ai/studio/playlist` | `ai:write` | KI-Studio: Playlist vorschlagen |
| POST | `/api/v1/stations/:sid/ai/studio/write` | `ai:write` | KI-Studio: Text schreiben (Art und Ton wählbar) |
| POST | `/api/v1/stations/:sid/ai/text` | `ai:write` | KI-Text erzeugen |
| POST | `/api/v1/stations/:sid/ai/transcribe` | `ai:write` | Sprache in Text umwandeln (Transkription) |

## Integrationen

Brücken zu Icecast/AzuraCast/laut.fm, Webhooks, laut.fm-Anbindung.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/bridge/mappings` | `bridge:write` | Brücken-Zuordnungen lesen |
| PUT | `/api/v1/bridge/stations/:key` | `bridge:write` | Brücken-Zuordnung eines externen Senders setzen |
| GET | `/api/v1/bridge/stations/:key/now-playing` | `bridge:write` | Aktuellen Titel über die Brücke lesen |
| POST | `/api/v1/bridge/stations/:key/now-playing` | `bridge:write` | Aktuellen Titel über die Brücke einliefern |
| GET | `/api/v1/lautfm/public/*` | Sitzung | Öffentliche laut.fm-API durchreichen (nur erlaubte Pfade) |
| GET | `/api/v1/stations/:sid/bridges` | `sources:read` | Brücken zu Icecast/AzuraCast/laut.fm auflisten |
| POST | `/api/v1/stations/:sid/bridges` | `sources:write` | Brücke anlegen |
| PATCH | `/api/v1/stations/:sid/bridges/:id` | `sources:write` | Brücke ändern |
| DELETE | `/api/v1/stations/:sid/bridges/:id` | `sources:write` | Brücke löschen |
| GET | `/api/v1/stations/:sid/integrations` | `stations:write` | Integrationen (Webhooks, E-Mail, Benachrichtigungen) lesen |
| PUT | `/api/v1/stations/:sid/integrations` | `stations:write` | Integrationen speichern |
| POST | `/api/v1/stations/:sid/integrations/test` | `stations:write` | Integration testen |
| GET | `/api/v1/stations/:sid/lautfm` | `lautfm:read` | laut.fm-Anbindung lesen |
| PUT | `/api/v1/stations/:sid/lautfm` | `lautfm:write` | laut.fm-Anbindung speichern |
| POST | `/api/v1/stations/:sid/lautfm/check` | `lautfm:read` | laut.fm-Anbindung prüfen |
| POST | `/api/v1/stations/:sid/lautfm/connect` | `lautfm:write` | Mit laut.fm verbinden |
| POST | `/api/v1/stations/:sid/lautfm/live-output` | `outputs:write` | laut.fm-Live-Ausgang einrichten |
| GET | `/api/v1/stations/:sid/lautfm/ra/*` | Sitzung | laut.fm-Radioadmin mit dem gespeicherten Token durchreichen (lesen, Recht lautfm:read) |
| POST | `/api/v1/stations/:sid/lautfm/ra/*` | Sitzung | laut.fm-Radioadmin mit dem gespeicherten Token durchreichen (schreiben, Recht lautfm:write; auch PUT, PATCH, DELETE) |
| POST | `/api/v1/stations/:sid/lautfm/relay-output` | `outputs:write` | laut.fm-Relay-Ausgang einrichten |

## Hörer-Interaktion

Posteingang, Umfragen, Formulare, Auslosungen und die Einstellungen des Hörerbereichs.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| POST | `/api/v1/stations/:sid/draw` | `queue:write` | Auslosung durchführen |
| GET | `/api/v1/stations/:sid/draws` | `queue:read` | Auslosungsprotokoll lesen |
| DELETE | `/api/v1/stations/:sid/draws` | `queue:write` | Auslosungsprotokoll leeren |
| GET | `/api/v1/stations/:sid/draws/csv` | `queue:read` | Auslosungsprotokoll als CSV |
| DELETE | `/api/v1/stations/:sid/form-entries/:id` | `queue:write` | Formulareintrag löschen |
| GET | `/api/v1/stations/:sid/forms` | `queue:read` | Formulare auflisten |
| POST | `/api/v1/stations/:sid/forms` | `stations:write` | Formular anlegen |
| PATCH | `/api/v1/stations/:sid/forms/:id` | `stations:write` | Formular ändern |
| DELETE | `/api/v1/stations/:sid/forms/:id` | `stations:write` | Formular löschen |
| GET | `/api/v1/stations/:sid/forms/:id/entries` | `queue:read` | Formulareinträge lesen |
| GET | `/api/v1/stations/:sid/forms/:id/entries/csv` | `queue:read` | Formulareinträge als CSV |
| GET | `/api/v1/stations/:sid/inbox` | `queue:read` | Hörer-Nachrichten und Wünsche (Posteingang) |
| POST | `/api/v1/stations/:sid/inbox/:id/:action` | `queue:write` | Nachricht bearbeiten: read, star, queue, delete |
| GET | `/api/v1/stations/:sid/inbox/:id/audio` | `queue:read` | Sprachnachricht abspielen |
| GET | `/api/v1/stations/:sid/listener` | `queue:read` | Einstellungen des Hörerbereichs lesen |
| PUT | `/api/v1/stations/:sid/listener` | `stations:write` | Einstellungen des Hörerbereichs speichern |
| GET | `/api/v1/stations/:sid/polls` | `queue:read` | Umfragen auflisten |
| POST | `/api/v1/stations/:sid/polls` | `stations:write` | Umfrage anlegen |
| PATCH | `/api/v1/stations/:sid/polls/:id` | `stations:write` | Umfrage ändern oder schließen |
| DELETE | `/api/v1/stations/:sid/polls/:id` | `stations:write` | Umfrage löschen |
| GET | `/api/v1/stations/:sid/polls/:id/csv` | `queue:read` | Umfrageergebnis als CSV |

## System

Server-Zustand, Speicher, Updates, Sicherungen, Einrichtung, Live-Ereignisse.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| PUT | `/api/v1/app/network` | Sitzung | Netzwerk-Einstellungen (Port, Zugriff von außen) setzen |
| GET | `/api/v1/app/origins` | Sitzung | Erlaubte Web-Herkunftsadressen (CORS) lesen |
| PUT | `/api/v1/app/origins` | Sitzung | Erlaubte Web-Herkunftsadressen (CORS) setzen |
| GET | `/api/v1/app/remote-link` | Sitzung | Fernzugriffs-Link lesen |
| PUT | `/api/v1/app/remote-link` | Sitzung | Fernzugriffs-Link einrichten |
| DELETE | `/api/v1/app/remote-link` | Sitzung | Fernzugriffs-Link entfernen |
| GET | `/api/v1/audio` | Sitzung | Audio-Engine-Status lesen |
| GET | `/api/v1/backup` | Sitzung | Sicherungen auflisten |
| POST | `/api/v1/backup` | Sitzung | Sicherung erstellen |
| POST | `/api/v1/backup/:file/restore` | Sitzung | Sicherung wiederherstellen |
| GET | `/api/v1/database` | Sitzung | Datenbankstatus lesen |
| GET | `/api/v1/encoder` | Sitzung | Encoder-Status lesen |
| GET | `/api/v1/events` | Sitzung | Live-Ereignisse als Server-Sent Events (?station=…) |
| GET | `/api/v1/health` | – | Öffentlicher Gesundheitsstand ohne Details |
| GET | `/api/v1/setup` | Sitzung | Einrichtungs-Assistent: Stand lesen |
| PUT | `/api/v1/setup/:step` | Sitzung | Einrichtungsschritt speichern |
| POST | `/api/v1/setup/installer-welcome/ack` | Sitzung | Willkommensseite des Installers bestätigen |
| GET | `/api/v1/site` | Sitzung | Ankündigungs-Banner und Wartungsmeldung lesen |
| PUT | `/api/v1/site` | Sitzung | Ankündigungs-Banner und Wartungsmeldung setzen |
| GET | `/api/v1/storage` | Sitzung | Speicher-Einstellungen lesen (lokal, Datenbank, Cloud) |
| PUT | `/api/v1/storage` | Sitzung | Speicher-Einstellungen speichern |
| POST | `/api/v1/storage/sync` | Sitzung | Speicher jetzt abgleichen |
| GET | `/api/v1/stream` | Sitzung | Stream-Status lesen |
| GET | `/api/v1/system` | Sitzung | System: Betriebssystem, Version, Auslastung |
| POST | `/api/v1/system/restart` | Sitzung | Server neu starten |
| POST | `/api/v1/system/shutdown` | Sitzung | Server beenden |
| GET | `/api/v1/update` | `automation:read` | Update-Status lesen |
| GET | `/api/v1/update/apk` | `automation:read` | Android-Update-Informationen lesen |
| POST | `/api/v1/update/install` | Sitzung | Verfügbares Update installieren |
| GET | `/api/v1/update/settings` | Sitzung | Update-Einstellungen lesen |
| PUT | `/api/v1/update/settings` | Sitzung | Update-Einstellungen speichern |

## Öffentlich & Hörer

Ohne Anmeldung erreichbar: Senderseite, Hörer-Funktionen, Statusdateien, Podcast-Feed.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/api/v1/public/network` | – | Öffentliche Senderliste |
| GET | `/api/v1/public/site` | – | Ankündigungs-Banner und Wartungsmeldung |
| GET | `/api/v1/public/stations/:sid/charts` | – | Öffentliche Charts |
| GET | `/api/v1/public/stations/:sid/cover/:mid` | – | Cover eines Chart-Titels |
| GET | `/api/v1/public/stations/:sid/listener` | – | Hörerbereich: Einstellungen und Funktionen des Senders |
| GET | `/api/v1/public/stations/:sid/listener/charts` | – | Hörerbereich: Wunsch-Charts |
| GET | `/api/v1/public/stations/:sid/listener/form` | – | Hörerbereich: Formular lesen (?id=) |
| POST | `/api/v1/public/stations/:sid/listener/form/submit` | – | Hörerbereich: Formular absenden |
| POST | `/api/v1/public/stations/:sid/listener/message` | – | Hörerbereich: Nachricht an das Studio senden |
| GET | `/api/v1/public/stations/:sid/listener/poll` | – | Hörerbereich: aktive Umfrage lesen |
| POST | `/api/v1/public/stations/:sid/listener/poll/vote` | – | Hörerbereich: an der Umfrage teilnehmen |
| POST | `/api/v1/public/stations/:sid/listener/request` | – | Hörerbereich: Musikwunsch senden |
| GET | `/api/v1/public/stations/:sid/listener/search` | – | Hörerbereich: Titel suchen (?q=) |
| POST | `/api/v1/public/stations/:sid/listener/voice` | – | Hörerbereich: Sprachnachricht senden (Audio im Body) |
| POST | `/api/v1/public/stations/:sid/listener/vote` | – | Hörerbereich: für einen Titel abstimmen |
| GET | `/api/v1/public/stations/:sid/page` | – | Öffentliche Senderseite: Name, Logo, aktueller Titel, Streams |
| GET | `/api/v1/public/stations/:sid/schedule` | – | Öffentlicher Sendeplan |

## Außerhalb von /api/v1

| Methode | Pfad | Zugriff | Beschreibung |
|---|---|---|---|
| GET | `/status.json` | öffentlich | Alle öffentlichen Sender mit Status (JSON) |
| GET | `/status/{sender}.json` | öffentlich | Stream-Status eines Senders (auch .xml im Icecast-Format, .m3u, .xspf) |
| GET | `/status/lautfm/{sender}.json` | öffentlich | Öffentlicher Status einer laut.fm-Station |
| GET | `/listen/{sender}/{mount}` | Recht stream:read | Stream hören (Audio); Token als Header oder ?token= |
| GET | `/hls/{sender}/{datei}` | Recht stream:read | HLS-Playlist und -Segmente der Zusatz-Streams |
| PUT | `/ingest/{sender}/{mount}` | Quell-Passwort | Icecast-kompatibler Quell-Eingang (auch Methode SOURCE), HTTP Basic |
| GET | `/download/AnMaCha-Cast-Android.apk` | öffentlich | Android-App herunterladen |
| GET | `/api/v1/openapi.json` | öffentlich | Diese Spezifikation (OpenAPI 3.1) |
| GET | `/api-docs.html` | öffentlich | Interaktive API-Dokumentation |
