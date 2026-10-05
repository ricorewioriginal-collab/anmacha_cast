# Architektur – AnMaCha Cast

Diese Datei ist eine **kompakte Navigationshilfe**, keine zweite Architektur-Wahrheitsquelle. Verbindliche Details stehen unter `docs/architecture/`.

## Schichten
- **Core:** `src/core/` – fachliche Kernbausteine.
- **Server:** `src/server/` – Laufzeit, HTTP/API, Auth, Persistenz, Streaming, Integrationen und Dienste.
- **Studio:** `studio/` – browserbasierte vollständige Bedienoberfläche.
- **Apps:** `apps/windows/` und `apps/android/` – plattformspezifische Anwendungen/Bridges.
- **Build/Packaging:** `scripts/`, `packaging/`.
- **Tests:** `test/`.
- **Dokumentation:** `docs/`, insbesondere `docs/architecture/`.

## Server
Einstieg ist `src/server/main.ts`. Große zentrale Dateien wie `app.ts` und `http.ts` verbinden zahlreiche Fachbereiche; vor Änderungen immer gezielt nach Route/Symbol suchen. Spezialisierte Bereiche liegen u. a. unter `src/server/api/`, `src/server/ai/` und `src/server/db/`.

## API
REST-API unter `/api/v1`. API-Dokumentation wird aus dem Code erzeugt:
- `docs/API.md`
- `docs/API-REFERENCE.md`
- `docs/openapi.json`
- Studio: `/api-docs.html`

Bei API-Änderungen Generator/Tests und veröffentlichte Spezifikation berücksichtigen.

## Persistenz
AnMaCha Cast unterstützt lokale und Server-Betriebsarten. Node stellt lokale SQLite-Funktionalität bereit; optionale DB-Treiber sind `pg` und `mysql2`. Docker Compose verwendet standardmäßig PostgreSQL 17. Daten-/Migrationslogik liegt unter `src/server/db/`. Keine zweite Persistenzschicht ohne Architekturgrund einführen.

## Audio / Streaming
FFmpeg/ffprobe sind zentrale Runtime-Abhängigkeiten für Audio, Playout, Encoder und Analyse. Streaming-/Bridge-Details stehen u. a. in `docs/STREAMING.md`, `docs/BRIDGE.md` und den Architektur-Dokumenten. Plattformpakete können Runtime-Binaries unterschiedlich bündeln.

## Frontends / Plattformen
Das Studio wird vom Server ausgeliefert. Windows kombiniert die AnMaCha-Cast-Engine mit nativer Windows-Anwendung. Android besitzt eigene App-/Bridge-Strukturen. Plattformcode darf die gemeinsame Server-/API-Architektur nicht unnötig duplizieren.

## Auth / Rechte / Mandantentrennung
Benutzer, Rollen, API-Schlüssel, Sendergrenzen und Geräte-/App-Kopplung sind sicherheitskritisch. Vor Änderungen `docs/architecture/SECURITY.md`, API-Doku und vorhandene Tests lesen. Jede sensible Route benötigt serverseitige Autorisierung; UI-Ausblendung allein ist keine Berechtigung.

## Deployment
Build und Deploy sind getrennte GitHub-Actions-Abläufe. Der Deploy arbeitet nur nach erfolgreichem Build bzw. manuell, sichert Daten, verweigert einen unsauberen Server-Checkout, aktualisiert per Fast-Forward und baut Container/Demo neu. Details in `docs/DEPLOY.md` und `.github/workflows/deploy.yml`.

## Branding / Migration
Öffentlicher Name ist **AnMaCha Cast**. Frühere Bezeichnungen dürfen nur für echte Abwärtskompatibilität/Migration erhalten bleiben, z. B. bei einer dokumentierten Legacy-Environment-Variable. Keine neuen alten Markenbezeichnungen einführen.
