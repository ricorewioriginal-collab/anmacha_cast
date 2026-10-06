# Entwicklung – AnMaCha Cast

## Mindestumgebung
- **Node.js >= 22.18** laut `package.json`.
- npm mit dem vorhandenen Lockfile; bevorzugt `npm ci`.
- TypeScript-Konfiguration: strict, NodeNext, ES2023, noEmit.
- Für Audio-/Playouttests: FFmpeg/ffprobe.
- Plattformbuilds benötigen zusätzliche Windows-/Android-/Linux-Werkzeuge; CI ist dafür die Referenz.

## Installation
```sh
npm ci
```

## Start
```sh
npm start
```
entspricht dem Start von `src/server/main.ts`.

Neuen Admin-Token erzeugen:
```sh
npm run token
```
Ausgabe niemals in Dokumentation/Chat/Commit übernehmen.

## Typecheck
```sh
npm run typecheck
```
Prüft Server/Core und Studio-TypeScript-Konfiguration.

## Tests
```sh
npm test
```

Gesamtprüfung:
```sh
npm run check
```
führt Typecheck und Tests aus.

**Wichtig:** Ergebnisse mit Node < 22.18 gelten nicht als vollständiger Nachweis für die laut Projekt geforderte Laufzeit.

## API-Dokumentation
```sh
npm run docs:api
```
Bei API-Änderungen generierte API-Referenz/OpenAPI und dazugehörige Tests berücksichtigen.

## Builds
```sh
npm run build
npm run build:win
npm run build:linux-deb
```
Build-Skripte liegen unter `scripts/`. Plattformübergreifende CI-Details stehen in `.github/workflows/build.yml`.

## Docker
```sh
docker compose up -d --build
docker compose logs -f anmachacast
```
Standard-Port ist 8750. Docker Compose nutzt standardmäßig PostgreSQL und persistente Volumes. Produktionspasswörter über lokale Environment-Konfiguration setzen; niemals Default-/Beispielpasswörter als produktiv behandeln.

## Tests vs. reale Verifikation
Automatisierte Tests sind kein Ersatz für reale Prüfung von:
- Audioausgabe/Encoder/FFmpeg,
- Live-Streaming,
- Provider-Verbindungen,
- Persistenz/Migration,
- Windows-Installer und native UI,
- Android-Gerätefunktionen,
- Mikrofon/Audio-Fokus,
- Remote-Verbindungen.

Den tatsächlichen Status gemäß `AI_HANDOVER.md` benennen.

## CI
`.github/workflows/build.yml` prüft u. a. Node/TypeScript/Tests, Datenbankvarianten, Plattformbuilds, Windows-Logik/Installer, Android und Docker. Vor Änderungen am Workflow zuerst nur den betroffenen Job lesen; die Datei ist groß.

## Deployment
Der öffentliche Server-/Demo-Stand wird serverseitig durch **AnMaCha Universal Deploy** aus `main` aktualisiert. Bei einem neuen Stand wird das Demo-Compose-Projekt aktualisiert und anschließend per Healthcheck geprüft. Der separate Demo-Reset bleibt ein eigener serverseitiger Timer. Die frühere GitHub-Action `deploy.yml` wurde entfernt.

## Runtime-Abhängigkeiten
`RUNTIME_DEPENDENCIES.md` enthält den aktuellen Auditstand. Nicht behaupten, ein vollständiges SBOM/Runtime-Audit sei abgeschlossen, solange die dort genannten Release-Nachweise offen sind.

## Secrets
`.env*` ist bis auf `.env.example` ignoriert. Keine Tokens/Keys in Fixtures oder Dokumentation. Bei versehentlicher Veröffentlichung Secret rotieren; bloßes Löschen aus dem aktuellen Commit reicht nicht.

## Weiterführend
- `CONTRIBUTING.md`
- `AI_HANDOVER.md`
- `docs/INSTALLATION.md`
- `docs/DOCKER.md`
- `docs/DEPLOY.md`
- `docs/PARALLEL_DEVELOPMENT.md`
