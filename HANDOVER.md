# Handover – AnMaCha Cast

## Aktueller Stand
AnMaCha Cast ist eine aktive TypeScript/Node-Radioautomation mit Server/REST-API, Browser-Studio, Windows-/Android-Anwendungen, Dockerbetrieb, mehreren Datenbankoptionen, Streaming/FFmpeg, MusicHub und umfangreicher CI-/Release-Automation.

`package.json` führt aktuell Version **0.5.1** und verlangt **Node >= 22.18**. Der öffentliche README-Status bezeichnet das Projekt derzeit weiterhin als **Beta**. Diese Datei bewertet nicht, ob der Beta-Status entfernt werden soll; öffentliche Release-/Brandingänderungen müssen bewusst erfolgen.

## Bestehende wichtige Wissensquellen
- `AI_HANDOVER.md` – ausführliche KI-Entwicklungsregeln.
- `docs/architecture/` – verbindliche Architektur.
- `README.md` – öffentlicher Projektstand.
- `RUNTIME_DEPENDENCIES.md` – noch laufendes Runtime-Audit.
- `docs/REBRANDING_ANMACHA_CAST.md` – Rebranding/Migration.
- `docs/PARALLEL_DEVELOPMENT.md` – parallele Entwicklung.

## Zuletzt abgeschlossen
- Einfach-/Profi-Modus (Web `studio/index.html` `data-pro` + `body.pro`, Windows `MainWindow.NavInfo` mit Pro-Flag, Datei `%LOCALAPPDATA%\AnMaChaCast\ansicht.txt`): Standard zeigt nur Sendezentrale, Live-Studio, laut.fm, Mediathek/Playlisten/Jingles, KI-Programmchef, Hörerstatistik, Einstellungen, Hilfe.
- Live-Encoder: laut.fm-Encoder werden getrennt angelegt; Verbinden/Trennen je Encoder (Web und Windows), ON-AIR-Zeit. Icecast-PUT ohne HTTP-Chunks (Icecast 2.4 entpackte sie nicht → Steuerzeichen im MP3). Titel-Metadaten mit `charset=UTF-8`, gemerkt und nach (Neu-)Verbinden sofort nachgereicht. Mikrofon aus beendet LIVE sofort. Gegen echten Icecast 2.4.4 geprüft (sauberes MP3, Titelwechsel ~0,35 s); Tests nutzen `rawIcecast()` aus `test/helpers.ts`.
- laut.fm-Playlisten vollständig verwaltbar (Web `studio/js/lautfm.js`, Windows `Pages/LautFmPage.cs`): Titel suchen und mehrfach hinzufügen, MP3 direkt in Playlist hochladen, entfernen/kopieren/verschieben, Playlist kopieren/leeren. Nur gegen einen lokalen Radioadmin-Nachbau geprüft, nicht gegen das echte laut.fm.
- Windows-App: Optik und Aufbau an das Web-Studio angeglichen, weiterhin natives WPF ohne Browser (Seitenleiste mit Wortmarke/LIVE/Abschnitten, Kopfzeile mit Senderwahl und Uhr, Panels, Decks A–D in Deckfarben, Cardwall, Stile in `apps/windows/Ui/Theme.xaml`). Neu: `AnMaChaCast.exe --snapshot <Ordner>` für Bildschirmfotos aller Seiten im CI-Job „windows“. Details: `docs/architecture/MULTI_PLATFORM.md`.
- Cast Tools: originale ArtCraft-Anwendungen (Apache-2.0) als Cast Sound/Photo/Film/Vector/Word/Effect, bei Bedarf aus dem offiziellen Release geladen und per SHA256SUMS geprüft (`src/server/services/tools.ts`, `src/server/zip.ts`, `/tools/<id>/` in CSP-Sandbox, Studio `studio/js/tools.js`, Windows `Pages/ToolsPage.cs`). SoundCraft hat noch kein Release → Hinweis statt Download. Tests: `test/cast-tools.test.ts`, Windows-Logik `ToolReleaseTests`.
- KI-Anbieter frei konfigurierbar: lokale KI (Vorlagen + Suche `POST /ai/discover`), Cloud-Vorlagen, eigene Anbieter mit Key-Header/Zusatz-Headern/Query (`src/server/ai/presets.ts`, `discover.ts`, `providers.ts`); Studio und Windows-App. Tests: `test/ai-providers-custom.test.ts`. Doku: `docs/AI.md`.
- Windows-App: Sendebedienung (ON AIR, „Jetzt läuft“, Betriebsart, MIC LIVE, Sendung) wie im Web in der Kopfzeile jeder Seite (`Ui/OnAirBar.cs`); laut.fm-Seite mit Stationswahl.
- laut.fm-Radioadmin stabiler nach den Regeln des Control Centers (`src/server/lautfm.ts`: Lesen bei Last wiederholen, Schreiben nie, Origin nach 401/403 neu ermitteln, deutsche Fehlermeldungen); Studio: Playlist-Titel über alle Seiten, Sendeplan ohne Basis-Playlist in den Einträgen und mit Gegenkontrolle. Tests: `test/lautfm-stability.test.ts`.
- Eine kompakte Claude-Code-Navigationsschicht wurde ergänzt: `CLAUDE.md`, `HANDOVER.md`, `PROJECT_MAP.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `KNOWN_ISSUES.md`. Sie ersetzt die bestehenden Fach-Dokumente nicht.

## Aktuell in Arbeit
- Paket 2 (Nutzerauftrag): Audio-Geräte & Routing Windows-optimiert (Mischpult/USB/Bluetooth/Klinke, mehrere Mikrofone, Decks auf Kanäle); KI-Programmchef-Funktionen des Control Centers (`ai-laut*.php`) eigenständig in AnMaCha Cast – Bestandsaufnahme: kein serverseitiger laut.fm-Programmchef vorhanden, Einstieg `LautfmService.radioadmin()`, `AiService.text()/voice()`, `app.ts tick()`.

## Nächste Session
1. aktuellen Git-Stand prüfen,
2. diese Handover-Datei und `PROJECT_MAP.md` lesen,
3. für die konkrete Aufgabe nur relevante Architektur-/Quell-/Testdateien öffnen,
4. Node-Version vor lokalen Tests prüfen,
5. nach größerer abgeschlossener Aufgabe diesen Handover knapp aktualisieren.

## Wichtige Warnungen
- Keine erfolgreichen Testbehauptungen unter Node < 22.18.
- Keine Fake-/Mock-Funktion als fertig ausgeben.
- Keine alten AirDeck-Bezeichnungen neu einführen.
- Build/Test ≠ manuell getestet ≠ live verifiziert.
- Deploy-/Release-Workflows nur gezielt ändern.
- Secrets niemals übernehmen.
