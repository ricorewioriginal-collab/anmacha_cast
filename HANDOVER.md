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
Eine kompakte Claude-Code-Navigationsschicht wurde ergänzt: `CLAUDE.md`, `HANDOVER.md`, `PROJECT_MAP.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `KNOWN_ISSUES.md`. Sie ersetzt die bestehenden Fach-Dokumente nicht.

## Aktuell in Arbeit
Keine Anwendungscode-Änderung wurde im Rahmen dieser Dokumentationsaufgabe begonnen.

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
