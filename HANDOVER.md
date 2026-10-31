# Handover – AnMaCha Cast

## Aktueller Stand
AnMaCha Cast ist eine aktive TypeScript/Node-Radioautomation mit Server/REST-API, Browser-Studio, Windows-/Android-Anwendungen, Dockerbetrieb, mehreren Datenbankoptionen, Streaming/FFmpeg, MusicHub und umfangreicher CI-/Release-Automation.

`package.json` führt aktuell Version **0.5.0** und verlangt **Node >= 22.18**. Der öffentliche README-Status bezeichnet das Projekt derzeit weiterhin als **Beta**. Diese Datei bewertet nicht, ob der Beta-Status entfernt werden soll; öffentliche Release-/Brandingänderungen müssen bewusst erfolgen.

## Bestehende wichtige Wissensquellen
- `AI_HANDOVER.md` – ausführliche KI-Entwicklungsregeln.
- `docs/architecture/` – verbindliche Architektur.
- `README.md` – öffentlicher Projektstand.
- `RUNTIME_DEPENDENCIES.md` – noch laufendes Runtime-Audit.
- `docs/REBRANDING_ANMACHA_CAST.md` – Rebranding/Migration.
- `docs/PARALLEL_DEVELOPMENT.md` – parallele Entwicklung.

## Zuletzt abgeschlossen
- Windows-App: Optik und Aufbau an das Web-Studio angeglichen, weiterhin natives WPF ohne Browser (Seitenleiste mit Wortmarke/LIVE/Abschnitten, Kopfzeile mit Senderwahl und Uhr, Panels, Decks A–D in Deckfarben, Cardwall, Stile in `apps/windows/Ui/Theme.xaml`). Neu: `AnMaChaCast.exe --snapshot <Ordner>` für Bildschirmfotos aller Seiten im CI-Job „windows“. Details: `docs/architecture/MULTI_PLATFORM.md`.
- KI-Anbieter frei konfigurierbar: lokale KI (Vorlagen + Suche `POST /ai/discover`), Cloud-Vorlagen, eigene Anbieter mit Key-Header/Zusatz-Headern/Query (`src/server/ai/presets.ts`, `discover.ts`, `providers.ts`); Studio und Windows-App. Tests: `test/ai-providers-custom.test.ts`. Doku: `docs/AI.md`.
- Windows-App: Sendebedienung (ON AIR, „Jetzt läuft“, Betriebsart, MIC LIVE, Sendung) wie im Web in der Kopfzeile jeder Seite (`Ui/OnAirBar.cs`); laut.fm-Seite mit Stationswahl.
- laut.fm-Radioadmin stabiler nach den Regeln des Control Centers (`src/server/lautfm.ts`: Lesen bei Last wiederholen, Schreiben nie, Origin nach 401/403 neu ermitteln, deutsche Fehlermeldungen); Studio: Playlist-Titel über alle Seiten, Sendeplan ohne Basis-Playlist in den Einträgen und mit Gegenkontrolle. Tests: `test/lautfm-stability.test.ts`.
- Eine kompakte Claude-Code-Navigationsschicht wurde ergänzt: `CLAUDE.md`, `HANDOVER.md`, `PROJECT_MAP.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `KNOWN_ISSUES.md`. Sie ersetzt die bestehenden Fach-Dokumente nicht.

## Aktuell in Arbeit
Keine.

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
