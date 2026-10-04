# Mitwirken an AnMaCha Cast

Danke für dein Interesse an **AnMaCha Cast – Radio Automation & Live Broadcast**.

AnMaCha Cast wird aktiv weiterentwickelt. Beiträge sollen sich in die bestehende Architektur einfügen, reale Funktionen erweitern und durch Tests abgesichert sein. Bitte keine parallelen Ersatzsysteme, Mock-Funktionen oder erfundenen Betriebsdaten als fertige Features einreichen.

> **Vor dem Start:** Lies die [`README.md`](README.md) für Projektstatus und Funktionsüberblick. Die verbindlichen technischen Grundlagen liegen unter [`docs/architecture/`](docs/architecture/). Das GitHub Wiki ist für Benutzerhandbuch und Bedienungsdokumentation vorgesehen. `AI_HANDOVER.md` dient ausschließlich der Koordination von Coding-Agents und ist keine technische Spezifikation.

## Lizenz zuerst lesen

AnMaCha Cast steht unter der projektspezifischen [`AnMaCha Cast Source Available License`](LICENSE).

Kurz gesagt:

- normale AnMaCha Cast-Nutzung und eigener Betrieb sind unter den Lizenzbedingungen kostenlos;
- AnMaCha Cast darf studiert, geklont, geforkt und verändert werden;
- eigene Radioeinnahmen lösen nicht allein deshalb eine Umsatzbeteiligung aus;
- kostenpflichtiges AnMaCha Cast-Hosting, AnMaCha Cast-SaaS, AnMaCha Cast-Abos, Reselling oder White Label für Dritte benötigen vorab eine gesonderte Commercial Hosting License;
- bei Weitergabe gelten die vorgeschriebenen Urheber- und Lizenzhinweise;
- inoffizielle Forks dürfen nicht als offizielle AnMaCha Cast-Releases dargestellt werden.

Siehe auch [`COMMERCIAL.md`](COMMERCIAL.md) und [`BRANDING.md`](BRANDING.md).

## Eigenständig entwickeln – offizielle Freigabe durch den Maintainer

Entwickler können das Projekt klonen oder forken und Änderungen eigenständig auf einem eigenen Branch entwickeln und testen.

Empfohlener Ablauf:

```text
Fork / Clone
   ↓
eigener Feature-Branch
   ↓
entwickeln + testen
   ↓
Pull Request an AnMaCha Cast
   ↓
CI + Review
   ↓
Freigabe durch den Maintainer
   ↓
Merge
   ↓
offizieller Build / versioniertes Release
```

Ein Fork, Commit oder Pull Request wird **nicht automatisch** Bestandteil des offiziellen AnMaCha Cast-Projekts. Die Aufnahme in einen offiziellen Build oder ein versioniertes Release erfolgt erst nach ausdrücklicher Prüfung und Freigabe durch den AnMaCha Cast-Maintainer.

Community-Entwickler können ihre Arbeit unabhängig weiterführen; solange sie nicht offiziell freigegeben wurde, muss eine mögliche Verwechslungsgefahr mit einem offiziellen AnMaCha Cast-Build vermieden werden.

## Branches und Pull Requests

Der Hauptbranch ist `main`. Er ist immer baubar und wird nur über Pull Requests verändert; direkt auf `main` wird nicht gepusht.

- Pro Aufgabe ein kurzer Arbeitsbranch (z. B. `fix/android-signing`, `feat/fdroid`), der von aktuellem `main` abzweigt.
- Pull Request gegen `main`. Die CI muss grün sein; gemergt wird per **Squash**, damit jede Aufgabe einen Commit auf `main` ergibt.
- Vor dem Push `git fetch` und bei Konflikten `main` in den Arbeitsbranch mergen (kein Force-Push auf fremde Branches).
- Ältere Branchnamen wie `AirDeck-Radio-Automation-&-Broadcast` stammen aus der Zeit vor der Umbenennung und werden nicht mehr verwendet.

## Entwicklungsumgebung

```bash
git clone https://github.com/ricorewioriginal-collab/anmacha_cast.git
cd anmacha_cast
npm ci
npm run check
npm start
```

Voraussetzung ist **Node.js 22.18 oder neuer** (`engines` in `package.json`; die CI nutzt Node 22). `npm run check` führt Typprüfung (Server und Studio) und alle Tests aus. Der Server startet auf `127.0.0.1:8750`; das Admin-Token steht beim ersten Start im Protokoll (`npm run token` erzeugt ein neues).

Für Broadcast-/Playout-Tests wird zusätzlich FFmpeg gebraucht. Weitere Laufzeitvoraussetzungen stehen in `RUNTIME_DEPENDENCIES.md` und `docs/INSTALLATION.md`.

Für die Apps:

| App | Voraussetzung | Prüfen |
|---|---|---|
| Android (`apps/android/`) | JDK 17, Android SDK | `cd apps/android && ./gradlew assembleDebug testDebugUnitTest` |
| Windows (`apps/windows/`) | .NET SDK | `dotnet test apps/windows/tests` und `dotnet build apps/windows/check/Check.csproj -c Release` |

## Architektur

AnMaCha Cast ist kein einzelnes statisches Web-Frontend. Änderungen müssen die bestehende Trennung von Core, Server, Persistenz, Diensten, Studio und Plattformpaketen respektieren.

Wichtige Bereiche:

| Bereich | Ort | Zweck |
|---|---|---|
| Core | `src/core/` | zentrale, möglichst I/O-unabhängige Radio-/Automation-Logik |
| Server | `src/server/` | Laufzeit, APIs, Streaming, Integrationen und Dienste |
| Datenhaltung | `src/server/db/`, `src/server/repo/` | Datenbanken, Migrationen und Repository-Schicht |
| Studio | `studio/` | Weboberfläche und Studio-Ansichten, dazu die Mobil-Web-App (`studio/mobil.*`, `studio/sw.js`) |
| Android | `apps/android/` | native Android-App (Kotlin/Compose): Go Live, Studio-Fernbedienung, Radioadmin |
| Windows | `apps/windows/` | native Windows-App; Installer und Paketierung in `packaging/windows/` |
| Pakete | `packaging/` | Windows-Installer, Linux-DEB, Docker/Demo, F-Droid-Metadaten (`packaging/fdroid/`) |
| Projektseite | `site/` | GitHub Pages (Startseite, Dokumentation, `ios.html`); zusammengebaut von `.github/workflows/pages.yml` |
| Skripte | `scripts/` | Build, API-Doku, Screenshots, Browser-Test, Schlüssel- und F-Droid-Werkzeuge |
| Tests | `test/` | automatisierte Tests und Integrationsprüfungen |
| Architektur | `docs/architecture/` | verbindliche technische Spezifikationen |

Die kanonische Architektur ist [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md). Alte oder widersprüchliche Dokumente dürfen nicht als Grundlage für neue Architekturentscheidungen verwendet werden.

## Vor einer neuen Funktion

Prüfe zuerst, ob AnMaCha Cast bereits ein passendes System besitzt.

Insbesondere keine zweite oder parallele Implementierung für:

- Authentifizierung und Benutzer,
- Rollen und Berechtigungen,
- Senderverwaltung,
- Mediathek oder MusikHub,
- Automation und Planung,
- Queue/Playout,
- Streaming-Ausgänge,
- Persistenz oder Datenbanken,
- Secrets,
- Events/SSE.

Bestehende Komponenten werden erweitert statt ersetzt, sofern keine ausdrücklich dokumentierte Migration vorgesehen ist.

## Studio / UI

Die Oberfläche ist Teil des realen AnMaCha Cast-Systems und darf keine Betriebszustände vortäuschen.

Daher:

- keine Fake-Hörerzahlen,
- kein statisches `ON AIR`, wenn der Serverzustand etwas anderes meldet,
- keine funktionslosen Buttons als vermeintlich fertige Features,
- keine Mock-Titel oder Mock-Statistiken im produktiven UI,
- keine zweite unabhängige Studio-Oberfläche neben der bestehenden Anwendung.

Wenn eine Backend-Fähigkeit noch fehlt, muss die Oberfläche einen ehrlichen Empty-/Unavailable-State anzeigen.

Bei UI-Änderungen bestehende Event-Listener, IDs, API-Aufrufe, SSE/WebSocket-Verbindungen, Player, Dialoge, Formulare und Senderkontext mitprüfen.

## Sicherheit

- Keine Passwörter, Tokens, API-Keys oder anderen Secrets committen.
- Keine Zugangsdaten aus Screenshots oder Referenzmaterial übernehmen.
- Eingaben und Pfade serverseitig validieren.
- Neue Endpunkte müssen in das bestehende Auth-/RBAC-/Scope-Modell integriert werden.
- Private Medien und Metadaten dürfen nicht über Suche, Counts, Cover, Collections, Events oder Downloads an unberechtigte Benutzer leaken.
- Berechtigungen wie Preview, Download und Broadcast nicht automatisch gleichsetzen.

Siehe auch [`docs/architecture/SECURITY.md`](docs/architecture/SECURITY.md).

## Datenbank und Persistenz

Keine neue Persistenz neben der bestehenden Datenbankschicht einführen, nur weil sie für einen einzelnen Feature-Block einfacher erscheint.

Neue persistente Daten gehören in die vorhandene DB-/Repository-Architektur einschließlich sauberer Migrationen und Tests.

Siehe [`docs/architecture/DATABASE.md`](docs/architecture/DATABASE.md).

## Integrationen

Externe Dienste wie Nextcloud, Icecast oder Provider-/Radio-Plattformen werden als klar abgegrenzte Integrationen behandelt.

- Keine API-Funktion allein aus Screenshots erraten.
- Externe Providerdaten validieren.
- Fehler und Nichtverfügbarkeit sauber behandeln.
- AnMaCha Cast-interne Berechtigungen bleiben maßgeblich.
- Nextcloud oder andere Storage-Anbieter ersetzen nicht das Benutzer-/Rechtesystem von AnMaCha Cast.

## Tests

Vor einem Commit mindestens:

```bash
npm run check
```

Zusätzlich die für den geänderten Bereich relevanten Tests ausführen (Android- und Windows-Befehle siehe oben). Bei Änderungen an `studio/` die Oberfläche tatsächlich öffnen und auf Browserfehler prüfen; die CI führt dafür `scripts/browser-smoke.mjs` gegen die Demo aus.

Eine Änderung gilt nicht allein deshalb als fertig, weil der Code kompiliert. In Dokumentation und Pull Requests sauber unterscheiden zwischen:

- implementiert,
- automatisiert getestet,
- manuell getestet,
- live verifiziert.

Nicht Getestetes (z. B. Windows-App auf echtem Windows, Android auf echtem Gerät, Läufe in GitHub Actions) wird im Pull Request ausdrücklich so benannt.

### Was die CI wann ausführt

Der Workflow `Build` entscheidet über den Job `changes` anhand der geänderten Dateien, um Laufzeit zu sparen:

| Geändert | Browser-Test | README-Screenshots neu |
|---|---|---|
| nur Apps, Docs, Tests | nein | nein |
| `src/`, `scripts/browser-smoke.mjs`, `package*.json`, `build.yml` | ja | nein |
| `studio/`, `scripts/screenshots.mjs`, `packaging/demo/` | ja | ja (wird automatisch auf `main` committet) |

Alle anderen Jobs (Tests, Docker, Android, Windows, Linux) laufen immer. Workflows nicht auf Verdacht umbauen: erst den konkret fehlgeschlagenen Job und sein Log untersuchen.

## Dokumentation

AnMaCha Cast trennt Dokumentation bewusst nach Zweck:

- `README.md` – öffentliche Projektübersicht, Status, Screenshots, Demo und Downloads
- [GitHub Wiki](https://github.com/ricorewioriginal-collab/anmacha_cast/wiki) – Benutzerhandbuch: Installation je Plattform, Apps, Bedienung. Quelle ist `docs/wiki/`; der Workflow `wiki-sync.yml` überträgt die Seiten nach jedem Merge auf `main` ins Wiki. Wiki-Änderungen deshalb per Pull Request machen, nicht im Wiki-Editor (sie würden überschrieben).
- `docs/architecture/` – verbindliche technische Architektur
- `docs/INSTALLATION.md`, `docs/DOCKER.md`, `docs/IOS.md` und weitere `docs/` – code-nahe technische Spezifikationen und Betriebsanleitungen
- `docs/openapi.json` und `docs/API-REFERENCE.md` – API; werden mit `npm run docs:api` erzeugt, nicht von Hand ändern
- `AI_HANDOVER.md` – kurze Übergabe zwischen Coding-Agents
- GitHub Releases – veröffentlichte Builds und Release Notes
- Issues/Projects – Bugs, Aufgaben und Planung

Ändert ein Beitrag das Verhalten oder die Installation, werden die betroffene `docs/`-Datei und bei Bedarf README und Wiki im selben Zug mitgepflegt. Bitte keine neue `*_PROGRESS.md`, `*_REMAINING.md` oder ähnliche parallele Statusdatei anlegen, wenn dieselbe Information sinnvoll in Issues/Projects, `AI_HANDOVER.md`, einer vorhandenen Spezifikation oder einem Release gepflegt werden kann.

Texte für Anwender sind auf Deutsch.

## Parallel arbeitende Agents

Am Repository können gleichzeitig Menschen und Coding-Agents arbeiten.

Vor Beginn und vor dem Push daher mindestens:

```bash
git fetch
git status
git log --oneline -5
```

Kein Force-Push auf gemeinsam genutzte Entwicklungsbranches. Keine fremden Änderungen zurücksetzen. Wenn ein Bereich in `AI_HANDOVER.md` ausdrücklich für einen anderen Agent reserviert ist, dort nicht parallel umbauen.

## Commits und Pull Requests

Bevorzugt kleine, nachvollziehbare Commits mit klarer Aufgabe.

Der Pull Request folgt der Vorlage [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). Er sollte kurz angeben:

1. Was wurde geändert?
2. Warum war die Änderung notwendig?
3. Welche Hauptdateien wurden geändert?
4. Welche Tests wurden ausgeführt?
5. Was wurde nur implementiert und was tatsächlich manuell/live verifiziert?
6. Gibt es bekannte Einschränkungen oder Folgearbeiten?
7. Soll die Änderung für einen offiziellen AnMaCha Cast-Build vorgeschlagen werden?

Keine unrelated Nebenänderungen in einen Feature-Commit mischen.

### Maintainer-Freigabe

Nur der Maintainer entscheidet im offiziellen Projekt über:

- Annahme/Merge eines Beitrags;
- Aufnahme in einen offiziellen AnMaCha Cast-Build;
- Versionsnummer und Release-Zuordnung;
- Kennzeichnung als offiziell unterstützt;
- Veröffentlichung über die offiziellen AnMaCha Cast-Releasekanäle.

## Beiträge und Nutzungsrechte

Beitragende behalten grundsätzlich ihre Rechte an ihren eigenen Beiträgen, soweit keine gesonderte Vereinbarung etwas anderes bestimmt.

Da AnMaCha Cast sowohl kostenlos bereitgestellt als auch künftig unter zusätzlichen kommerziellen Bedingungen angeboten werden kann, kann für bestimmte Beiträge vor der Aufnahme eine zusätzliche Contributor-Vereinbarung erforderlich werden. Reiche nur Inhalte ein, für die du die erforderlichen Rechte besitzt.

Ein Pull Request darf keine Lizenzbedingungen enthalten, die AnMaCha Cast daran hindern würden, den Beitrag innerhalb des bestehenden AnMaCha Cast-Lizenz- und Distributionsmodells zu verwenden.

## Builds und Releases

Die GitHub-Actions-Workflows prüfen mehrere AnMaCha-Cast-Ziele. Änderungen an Packaging-, Installer- oder Release-Workflows benötigen besondere Sorgfalt, weil sie Windows, Linux, Docker, Android oder Demo-Builds beeinflussen können.

Ein grüner lokaler Test ersetzt nicht die CI. Umgekehrt sollten Workflows nicht auf Verdacht umgebaut werden, wenn nur ein einzelner Plattformjob fehlschlägt – zuerst den konkreten fehlgeschlagenen Job und dessen Log untersuchen.

Was bei einem Push auf `main` entsteht:

- **Release „aktueller Stand“** mit Windows-Installer, Portable-ZIP, Android-APK und Linux-DEB.
- **Android-APK:** Mit den Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` wird sie als Release-Build mit dem festen Projektschlüssel signiert und die Signatur im Build geprüft; Pull Requests erhalten nur eine Debug-Signatur. Den Schlüssel erzeugt `scripts/create-android-keystore.sh`; er gehört nie ins Repository, nie in einen Chat und muss gesichert werden (Details in `docs/INSTALLATION.md`).
- **F-Droid-Repository** (`.../anmacha_cast/fdroid/repo`): wird von `pages.yml` mit `scripts/build-fdroid-repo.sh` aus der signierten Release-APK erzeugt, nur wenn deren Signatur zum hinterlegten Schlüssel passt.
- **Projektseite** (GitHub Pages): `site/` plus Mobil-Web-App und API-Dokumentation, ebenfalls über `pages.yml`.
- Windows-Programme werden nur mit hinterlegtem Zertifikat signiert (`WINDOWS_CERT_PFX_B64`, `WINDOWS_CERT_PASSWORD`).

Secrets und Schlüssel werden ausschließlich als GitHub-Secrets verwaltet.

## Lizenz und Hinweise

Beachte [`LICENSE`](LICENSE), [`COMMERCIAL.md`](COMMERCIAL.md), [`BRANDING.md`](BRANDING.md) sowie die weiteren im Repository enthaltenen Haftungs- und Rechtshinweise.

Beiträge dürfen keine fremden Zugangsdaten, proprietären Referenzdateien oder Inhalte enthalten, für die keine ausreichenden Rechte vorliegen.
