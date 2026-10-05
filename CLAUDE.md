# Claude Code – AnMaCha Cast

## Session-Start
Bei einer neuen Entwicklungs-Session in dieser Reihenfolge lesen:
1. `CLAUDE.md`
2. `HANDOVER.md`
3. `PROJECT_MAP.md`
4. `AI_HANDOVER.md` für verbindliche KI-Entwicklungsregeln
5. nur bei Architekturfragen die relevante Datei unter `docs/architecture/`
6. nur bei Bedarf `DEVELOPMENT.md`
7. anschließend ausschließlich die für die konkrete Aufgabe relevanten Quell- und Testdateien

Nicht automatisch das gesamte Repository erneut analysieren.

## Projekt
**AnMaCha Cast** ist eine eigenständige Radio-Automation und Live-Broadcast-Plattform für Windows, Android, Linux/Server, Docker und Browser. Sie umfasst Automation/Playout, Live Studio, Decks/Cardwall, Mediathek, Playlists, Sendeplanung, Streaming, Recorder, Podcast, externe Provider, MusicHub, mehrere Sender, Benutzer/Rollen und eine REST-API.

Der Produktname lautet exakt **AnMaCha Cast**. Alte AirDeck-Bezeichnungen sind nur dort zulässig, wo sie aus Kompatibilitäts-/Migrationsgründen technisch erforderlich sind. Keine neuen öffentlichen AirDeck-Bezeichnungen einführen.

## Wahrheitsquellen
Nicht mehrere parallele Dokumentationssysteme erzeugen:
- `README.md`: öffentliche Übersicht, Demo, Downloads, aktueller Produktstatus.
- `AI_HANDOVER.md`: verbindlicher Leitfaden für KI-unterstützte Entwicklung.
- `docs/architecture/`: verbindliche technische Architektur.
- `docs/API.md`, `docs/API-REFERENCE.md`, `docs/openapi.json`: API.
- `CONTRIBUTING.md`: Entwicklungs-/Beitragsregeln.
- `RUNTIME_DEPENDENCIES.md`: Runtime-Abhängigkeiten und noch offene Release-Nachweise.
- `docs/REBRANDING_ANMACHA_CAST.md`: historische/technische Rebranding- und Migrationsdetails, nicht als aktuelle Aufgabenliste behandeln.
- Issues/Projects: Bugs und geplante Arbeit.
- Releases/`CHANGELOG.md`: veröffentlichte Versionen.

## Technik in Kürze
- TypeScript/Node.js, ESM.
- **Node.js >= 22.18 ist laut `package.json` erforderlich.**
- TypeScript strict, `noEmit`, NodeNext.
- Server-Einstieg: `src/server/main.ts`.
- Server/API: `src/server/`, REST-API unter `/api/v1`.
- Kernlogik: `src/core/`.
- Studio-Weboberfläche: `studio/`.
- Apps: `apps/windows/`, `apps/android/`.
- Persistenz: lokale SQLite-Unterstützung sowie externe PostgreSQL/MySQL/MariaDB-Treiber je Betriebsart; Docker Compose nutzt standardmäßig PostgreSQL.
- Audio/Streaming: FFmpeg/ffprobe; weitere optionale Integrationen laut Runtime-Doku.
- Build-/Packaging-Skripte: `scripts/`, `packaging/`.
- Tests: `test/`.
- CI/Release/Deploy: `.github/workflows/`.

## Wichtige Befehle
```sh
npm ci
npm run typecheck
npm test
npm run check
npm run build
npm run build:win
npm run build:linux-deb
npm run docs:api
```

**Keine erfolgreichen Testaussagen mit Node < 22.18.** Wenn die lokale Umgebung die Engine-Anforderung nicht erfüllt, dies klar melden statt den Teststatus zu behaupten.

## Arbeitsweise
- Aktuellen Git-Stand zuerst prüfen: `git fetch`, `git status`, Branch und letzten Commit.
- Bestehende Architektur erweitern, nicht parallel neu erfinden.
- Vor neuen Auth-, Rollen-, Sender-, DB-, Mediathek-, MusicHub-, Automation-, Streaming-, Secret- oder Event-Systemen prüfen, was bereits existiert.
- Keine Fake-Daten, Fake-ON-AIR-Zustände, Mock-APIs oder Buttons ohne echte Funktion als fertige Implementierung.
- Große Dateien wie `src/server/http.ts` und `src/server/app.ts` nicht blind vollständig analysieren; zuerst nach Route, Symbol oder Fachbereich suchen.
- Keine unnötigen Refactorings außerhalb der Aufgabe.
- Keine alten Prompts/ZIP-Handover als Wahrheit gegenüber aktuellem Code verwenden.
- `node_modules`, Build-Ausgaben, App-Binärartefakte, Caches und Laufzeitdaten nicht analysieren, sofern nicht für die Aufgabe erforderlich.

## Tests und Qualität
- Nach Änderungen die kleinste sinnvolle relevante Testmenge ausführen.
- Bei breiteren Änderungen `npm run check`.
- Kritische Audio-, Streaming-, Auth-, Persistenz-, Installer- und Plattformfunktionen benötigen zusätzlich reale/manuelle Prüfung; automatisierte Tests nicht als „live verifiziert“ ausgeben.
- Begriffe aus `AI_HANDOVER.md` korrekt unterscheiden: implementiert, automatisiert getestet, manuell getestet, live verifiziert, security-reviewed.

## Sicherheit
- Keine echten Tokens, Passwörter, SSH-Keys, DB-Zugänge, Streaming-Credentials oder private Schlüssel in Code, Tests, Dokumentation oder Prompts übernehmen.
- Auth/RBAC, Sender-/Tenant-Grenzen, Uploads, Pfade, SSRF, XSS, CORS, SSE/WebSockets, Secrets und Shell-Aufrufe bei relevanten Änderungen gezielt prüfen.
- Sicherheitsprüfungen nicht entfernen, nur damit ein Codepfad funktioniert.
- `.gitleaks.toml` und Security-Workflow respektieren.

## Git / parallele Entwicklung
- Fremde oder uncommittete Änderungen nicht überschreiben.
- `docs/PARALLEL_DEVELOPMENT.md` und den Parallel-Change-Guard beachten, wenn mehrere Agenten/Branches beteiligt sind.
- Kein Force-Push auf gemeinsam genutzte Branches.
- Vor Push `git diff`, `git status` und relevante Tests prüfen.
- Commit/Push nur gemäß Benutzerauftrag.

## Build, Release und Deploy
- `.github/workflows/build.yml` baut/testet mehrere Plattformen und Pakete.
- `.github/workflows/deploy.yml` kann nach erfolgreichem Build von `main` bzw. manuell den Server/Demo-Stand aktualisieren.
- Deploy sichert den bestehenden Stand, verweigert einen unsauberen Server-Checkout, aktualisiert per Fast-Forward, baut Docker neu und prüft Demo/Health.
- Release-, Pages-, Screenshot-, Changelog- und Security-Workflows nicht ohne konkreten Grund ändern.
- Version kommt aktuell aus `package.json`; keine zusätzliche `VERSION`-Wahrheitsquelle erzeugen.

## Dokumentation nach größeren Aufgaben
- `HANDOVER.md`: aktueller Arbeitsstand und nächste Schritte.
- `ARCHITECTURE.md`: nur kompakte Navigation; echte Architekturänderung zusätzlich in der passenden Datei unter `docs/architecture/`.
- `DEVELOPMENT.md`: nur bei geänderten Entwicklungs-/Build-/Testabläufen.
- `PROJECT_MAP.md`: bei wesentlichen Strukturänderungen.
- `KNOWN_ISSUES.md`: nur bestätigte, noch relevante Probleme.
