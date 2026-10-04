# Entwickeln und Mitwirken

Ausführliche Regeln stehen in [CONTRIBUTING.md](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/CONTRIBUTING.md). Kurzfassung:

## Entwicklungsumgebung

```bash
git clone https://github.com/ricorewioriginal-collab/anmacha_cast.git
cd anmacha_cast
npm ci          # Node.js 22.18 oder neuer
npm run check   # Typprüfung + alle Tests
npm start       # Server auf 127.0.0.1:8750
```

Android: `cd apps/android && ./gradlew assembleDebug testDebugUnitTest` (JDK 17, Android SDK). Windows: `dotnet test apps/windows/tests`.

## Ablauf

1. Arbeitsbranch von `main` anlegen, entwickeln, testen.
2. Pull Request gegen `main` (Vorlage ausfüllen, nicht Getestetes ausdrücklich nennen).
3. CI grün, Review, Freigabe durch den Maintainer, Squash-Merge.

Die CI baut Windows, Linux (DEB), Docker und Android; Browser-Test und README-Screenshots laufen nur bei passenden Änderungen. Auf `main` entstehen das Release „aktueller Stand“, die signierte Android-APK, das F-Droid-Repository und die Projektseite.

## Wichtige Regeln

- Keine Secrets, Schlüssel oder Passwörter ins Repository.
- Bestehende Systeme erweitern (Benutzer, Rechte, Mediathek, Automation, Persistenz), keine Parallelimplementierung.
- Die Oberfläche täuscht keine Betriebszustände vor.
- Neue Endpunkte gehören in das vorhandene Auth-/Rechtemodell; die API-Doku wird mit `npm run docs:api` erzeugt.

## Wo liegt was

| Ort | Inhalt |
|---|---|
| `src/core`, `src/server` | Logik, APIs, Dienste |
| `studio/` | Weboberfläche und Mobil-Web-App |
| `apps/android`, `apps/windows` | native Apps |
| `packaging/` | Installer, DEB, Docker/Demo, F-Droid |
| `docs/architecture/` | verbindliche Architektur |

Lizenz: AnMaCha Cast Source Available License; kommerzielles Hosting nur mit gesonderter Lizenz (siehe [COMMERCIAL.md](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/COMMERCIAL.md)).
