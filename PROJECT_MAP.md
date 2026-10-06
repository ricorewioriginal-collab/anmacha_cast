# Projektkarte – AnMaCha Cast

Kompakte Suchhilfe; keine vollständige Dateiliste.

| Pfad | Aufgabe |
|---|---|
| `src/core/` | fachliche Kernlogik. |
| `src/server/main.ts` | Server-/Engine-Einstieg. |
| `src/server/app.ts` | zentrale App-Komposition; große Datei, gezielt durchsuchen. |
| `src/server/http.ts` | umfangreiche HTTP-/Routing-Schicht; gezielt nach Route/Funktion suchen. |
| `src/server/api/` | API-bezogene Module. |
| `src/server/db/` | Datenbanken/Persistenz/Migrationen. |
| `src/server/ai/` | KI-Funktionen. |
| `src/server/ffmpeg.ts` | FFmpeg-Anbindung. |
| `src/server/icecast.ts`, `lautfm.ts`, `bridge.ts` | Streaming-/Provider-/Bridge-Bereiche. |
| `studio/` | komplette Browser-Studio-Oberfläche und Handbuch/API-Doku. |
| `apps/windows/` | native Windows-Anwendung und Tests/Checks. |
| `apps/android/` | Android-App und Engine/Bridge. |
| `test/` | Node-Test-Suite. |
| `scripts/` | Build-, API-Doku- und Hilfsskripte. |
| `packaging/` | Installer, Demo- und Plattform-Packaging. |
| `docs/architecture/` | verbindliche technische Architektur. |
| `docs/API.md`, `API-REFERENCE.md`, `openapi.json` | API-Dokumentation. |
| `docs/STREAMING.md` | Streaming-Fach-Doku. |
| `docs/BRIDGE.md` | externe Brücken/Webhooks. |
| `docs/PARALLEL_DEVELOPMENT.md` | parallele Entwicklungsarbeit. |
| `RUNTIME_DEPENDENCIES.md` | Runtime-Audit/Abhängigkeiten. |
| `AI_HANDOVER.md` | KI-Entwicklungsregeln. |
| `.github/workflows/build.yml` | zentrale Multi-Plattform-CI. |
| `docs/DEPLOY.md` | serverseitiger Server-/Demo-Deployment-Ablauf mit AnMaCha Universal Deploy. |

## Wo zuerst suchen?
- **API/Route:** Route oder Handlernamen in `src/server/http.ts`/`src/server/api/` suchen, dann passende Tests.
- **DB/Migration:** `src/server/db/` und Architektur-Doku.
- **Studio/UI:** konkrete Datei/Element/Funktion in `studio/`; nicht das gesamte Studio lesen.
- **Streaming/Audio:** Providerdatei + `ffmpeg.ts` + `docs/STREAMING.md`.
- **Auth/RBAC:** Security-Architektur + relevante Servermodule + Tests.
- **Windows:** `apps/windows/`, Build-/Installer-Abschnitt der CI.
- **Android:** `apps/android/`, Android-Job der CI und plattformspezifische Doku.
- **MusicHub:** nach `music-hub`/MusicHub in Server, Studio, Tests und `docs/MUSIKHUB_PROGRESS.md` suchen.
- **Deploy/Demo:** `docs/DEPLOY.md`, `packaging/demo/`, Deploy-Workflow.
- **Rebranding/Altname:** nur `docs/REBRANDING_ANMACHA_CAST.md` und tatsächliche Legacy-Kompatibilität prüfen.
