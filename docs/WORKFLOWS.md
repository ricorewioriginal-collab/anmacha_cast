# AnMaCha Cast – GitHub Actions / CI-CD Workflow-Handbuch

> **Zweck dieses Dokuments**  
> Diese Datei ist die technische Referenz für Entwickler, Maintainer und KI-Tools, die am AnMaCha-Cast-Repository arbeiten. Sie beschreibt nicht nur einzelne GitHub-Actions-Dateien, sondern die **beabsichtigte Gesamtlogik** der Build-, Release-, Dokumentations-, Sicherheits- und Rollback-Automatisierung.
>
> **Wichtig für KI-Tools:** Workflows nicht isoliert verändern. Vor Änderungen an `.github/workflows/**` zuerst dieses Dokument, `CONTRIBUTING.md`, `AI_HANDOVER.md` und die betroffenen Workflow-Dateien lesen. Bestehende Schutzmechanismen dürfen nicht stillschweigend entfernt oder umgangen werden.

---

## 1. Zentrale Grundsätze

AnMaCha Cast verwendet GitHub Actions als zusammenhängende CI/CD-Kette.

Die gewünschte Reihenfolge lautet vereinfacht:

```text
Code / Dependency Update / Pull Request
                │
                ▼
        Security + Build/Tests
                │
          ┌─────┴─────┐
          │           │
       ERFOLG       FEHLER
          │           │
          ▼           ▼
 last-known-good   Auto-Rollback*
          │
          ▼
       Release
          │
          ├── Release Badge
          ├── Release Changelog
          ├── Release Screenshots
          └── Release Health
```

`*` Der automatische Rollback ist absichtlich abgesichert und darf neuere Arbeit nicht überschreiben.

### Grundregeln

1. Ein fehlgeschlagener Build darf nicht als funktionierendes Release behandelt werden.
2. Releases basieren auf nachvollziehbaren Git-Ständen/Tags.
3. `last-known-good` bezeichnet den Commit des letzten erfolgreichen Haupt-Builds.
4. Rollbacks werden als **neue Revert-Commits** ausgeführt – kein automatischer Force-Reset der Branch-Historie.
5. Release-Dokumentation soll sich aus tatsächlichen Releases und Git-Daten ableiten und keine Änderungen erfinden.
6. Dependency-Major-Upgrades müssen als Migration behandelt und getestet werden.
7. Secrets, Keystores und private Schlüssel gehören nicht ins Repository.
8. Automatisch erzeugte Screenshots dürfen den normalen Build nicht zerstören.
9. CI-eigene Dokumentationscommits sollen unnötige Build-Schleifen vermeiden.
10. Der aktive Entwicklungsbranch ist derzeit `main`.

---

## 2. `build.yml` – Haupt-Build

**Workflow-Name:** `Build`

Der Build ist die zentrale technische Qualitätskontrolle des Projekts. Andere Workflows – insbesondere `Last Known Good` – verlassen sich auf seinen exakten Workflow-Namen und sein Ergebnis.

Typische Trigger:

- Push auf `main`
- Pull Requests
- manuelle Ausführung
- Versionstags entsprechend der Build-Konfiguration

Der Build darf nicht leichtfertig umbenannt werden. Falls `name: Build` geändert wird, muss mindestens `last-known-good.yml` angepasst werden.

### Bedeutung eines grünen Builds

Ein erfolgreicher Build bedeutet, dass die im Workflow definierten Prüfungen erfolgreich abgeschlossen wurden. Nur dieser Zustand darf automatisch als neuer `last-known-good` gespeichert werden.

### Bedeutung eines roten Builds

Ein fehlgeschlagener Build bedeutet **nicht automatisch**, dass das Repository dauerhaft beschädigt ist. Der Fehler kann beispielsweise durch Dependency-Upgrades, Android/Gradle, Packaging, Tests oder Konfiguration verursacht werden.

Der Fehlerzustand wird vom Last-Known-Good-System verarbeitet.

---

## 3. `last-known-good.yml` – Sicherheitsnetz und Rollback

Dieser Workflow beobachtet den Workflow **`Build`** über `workflow_run`.

### 3.1 Erfolgreicher Build

Wenn:

```text
Build = success
Branch = main
```

wird der erfolgreiche Commit mit dem beweglichen Git-Tag

```text
last-known-good
```

markiert.

Der Tag wird bei späteren erfolgreichen Builds auf den neuen grünen Commit verschoben.

### 3.2 Fehlgeschlagener Build

Bei einem Fehler prüft die Automatik mehrere Sicherheitsbedingungen, bevor sie einen Rollback versucht.

Ein automatischer Rollback darf nur stattfinden, wenn unter anderem:

- der Build tatsächlich fehlgeschlagen ist,
- der Fehler auf dem aktiven Entwicklungsbranch aufgetreten ist,
- ein `last-known-good` existiert,
- der Branch seit dem fehlgeschlagenen Build **nicht bereits weiterentwickelt wurde**,
- `last-known-good` ein Vorfahr des aktuellen Commits ist,
- der fehlgeschlagene Commit nicht bereits selbst ein Rollback-Commit ist.

### Warum diese Prüfung wichtig ist

Beispiel:

```text
A = letzter grüner Stand
B = Dependency-Merge -> Build rot
C = Claude repariert bereits etwas
```

Wenn der Branch inzwischen auf `C` steht, darf der fehlgeschlagene Build von `B` **nicht** automatisch `C` überschreiben.

### 3.3 Art des Rollbacks

Der Workflow verwendet keinen automatischen Hard Reset/Force Push auf den Entwicklungsbranch.

Stattdessen werden die Änderungen seit `last-known-good` als nachvollziehbarer Revert-Commit zurückgenommen.

Beispiel:

```text
A -- B -- C
          │
       Build rot
          │
          ▼
A -- B -- C -- R
               ^
          Revert-Commit
```

Die Historie bleibt erhalten.

### 3.4 Endlosschleifen vermeiden

Rollback-Commits werden entsprechend gekennzeichnet und sollen keine unendliche Kette aus

```text
Build -> Rollback -> Build -> Rollback -> ...
```

auslösen.

### 3.5 Manueller Notfall-Rollback

Zusätzlich zur Automatik kann `Last Known Good` manuell gestartet werden.

Aktionen:

- `show` – gespeicherten letzten grünen Commit anzeigen
- `rollback` – gezielt auf den letzten grünen Zustand zurückrollen

Für einen manuellen Rollback ist die Bestätigung `ROLLBACK` erforderlich.

---

## 4. Release-Prozess

Ein GitHub-Release ist die veröffentlichte Version von AnMaCha Cast. Ein Release darf nicht mit einem beliebigen Entwicklungscommit verwechselt werden.

Der Release-Prozess stößt mehrere Folgeprozesse an.

```text
GitHub Release veröffentlicht
        │
        ├── Versionsbadge aktualisieren
        ├── Changelog aktualisieren
        ├── UI-Screenshots überprüfen/erzeugen
        └── Release Health prüfen
```

Diese Aufgaben haben unterschiedliche Verantwortlichkeiten und sollten nicht unnötig zu einem riesigen Workflow zusammengelegt werden.

---

## 5. `release-badge.yml` – aktuelle Versionsanzeige

Zweck:

- aktuelles veröffentlichtes GitHub-Release ermitteln,
- Release-Tag als Versionsquelle verwenden,
- AnMaCha-Cast-eigenes `assets/readme/status/version.svg` aktualisieren,
- optional Release-/Codename darstellen,
- README auf den eigenen AnMaCha-Cast-Versionsbutton vereinheitlichen.

### Single Source of Truth

Für die öffentlich angezeigte aktuelle Version ist das **aktuell veröffentlichte GitHub-Release** maßgeblich – nicht eine manuell in der README eingetragene Versionsnummer.

Beispiel:

```text
GitHub Release Tag: v0.4.1
Release Name: AnMaCha Cast Aurora v0.4.1

=> Badge: v0.4.1 / AURORA
```

Neue Versionen dürfen nicht dauerhaft per Hand in das Badge-SVG geschrieben werden, ohne die Automatik zu berücksichtigen.

---

## 6. `changelog.yml` – automatische Versionshistorie

Zweck:

- veröffentlichte GitHub-Releases abrufen,
- chronologisch dokumentieren,
- vorherigen und aktuellen Release-Tag vergleichen,
- Git-Historie zwischen den Versionen zusammenfassen,
- `CHANGELOG.md` automatisch aktualisieren.

### Wichtig

Die Automatik darf keine fachlichen Änderungen erfinden.

Sie darf technische Fakten aus Git/Release-Daten dokumentieren. Verständliche, kuratierte Release Notes können weiterhin direkt am GitHub-Release gepflegt werden.

### `CHANGELOG.md`

Der automatisch gepflegte Bereich wird durch Marker begrenzt:

```html
<!-- AUTO-CHANGELOG:START -->
...
<!-- AUTO-CHANGELOG:END -->
```

KI-Tools und Entwickler dürfen diese Marker nicht entfernen, wenn die Automatik erhalten bleiben soll.

Der Bereich `Unreleased` ist für bewusst dokumentierte, noch nicht veröffentlichte Änderungen vorgesehen.

---

## 7. Release-Screenshots

AnMaCha Cast besitzt eine Screenshot-/Galerie-Logik für README und Projektseite.

Bei neuen Veröffentlichungen sollen die UI-Screenshots erneut überprüft bzw. generiert werden, damit Dokumentation und aktuelle Version nicht auseinanderlaufen.

Typischer Ablauf:

```text
Release
  │
  ▼
Demo/Anwendung bauen
  │
  ▼
UI/Smoke-Test
  │
  ▼
Screenshots erzeugen
  │
  ├── identisch -> kein unnötiger Commit
  │
  └── verändert -> Screenshots/GIF aktualisieren
```

### Wichtige Regel

Die Screenshot-Automatisierung ist Dokumentation. Sie darf den eigentlichen Produktcode oder Build nicht unnötig verändern.

README und Projektseite verwenden verkleinerte Vorschauen; Originalbilder sollen anklickbar bleiben.

---

## 8. `release-health.yml` – veröffentlichte Version kontrollieren

Dieser Workflow kontrolliert nicht primär den Quellcode, sondern die **tatsächlich veröffentlichte Version**.

### Release-Konsistenz

Prüft unter anderem:

- Release-Tag gegen Projektversion,
- Android-Projektversion, soweit konfiguriert,
- README-Versionsbutton,
- dynamische Downloadlinks.

### Release-Dateien

Erwartete veröffentlichte Pakete umfassen derzeit unter anderem:

- `AnMaCha-Cast-Setup.exe`
- `AnMaCha-Cast-Windows-Portable.zip`
- `AnMaCha-Cast-Android.apk`
- `AnMaCha-Cast-Linux.deb`

Der Workflow prüft, ob Dateien vorhanden, nicht leer, herunterladbar und strukturell lesbar sind.

### Öffentliche Dienste

Zusätzlich können Projektseite, Dokumentation, Demo, Health-Endpunkt und Latest-Release-Ziel geprüft werden.

### Wiederkehrende Prüfung

Release Health kann zusätzlich zeitgesteuert laufen, um später auftretende Probleme zu erkennen.

---

## 9. `security.yml` – Sicherheitsprüfungen

Der Security-Workflow dient als zusätzliche Schutzschicht.

Bereiche:

- `npm audit` für bekannte relevante Dependency-Schwachstellen,
- zusätzliche Lockfiles/Teilprojekte,
- Gitleaks/Secret-Scanning,
- Erkennung versehentlich eingecheckter privater Dateien.

Besonders kritisch sind beispielsweise:

```text
*.jks
*.keystore
*.p12
*.pfx
*.pem
id_rsa
id_ed25519
.env
.env.*
```

Beispiel-/Template-Dateien wie `.env.example` können ausdrücklich erlaubt sein.

### Niemals zur Build-Reparatur

Nicht einfach:

```bash
npm audit fix --force
```

verwenden, wenn dadurch ungeprüfte Breaking Changes eingeführt werden.

---

## 10. Dependabot

`.github/dependabot.yml` kontrolliert automatische Update-Vorschläge.

Dependabot darf Updates als Pull Requests vorschlagen. Das bedeutet **nicht**, dass jedes Update automatisch kompatibel ist.

### Besonders bei Major-Upgrades

Beispiele:

- Capacitor
- TypeScript
- Node-Typdefinitionen
- Electron-/Packaging-Werkzeuge
- Android/Gradle

müssen auf Breaking Changes geprüft werden.

Zusammengehörige Pakete sollen als gemeinsame Migration betrachtet werden.

Beispiel Capacitor:

```text
@capacitor/core
@capacitor/android
@capacitor/cli
```

Diese Versionen nicht unabhängig voneinander wild mischen.

---

## 11. GitHub Pages / AnMaCha-Cast-Projektseite

Die AnMaCha-Cast-Projektseite und Dokumentationsseite bilden eine öffentliche Oberfläche für das Repository.

Die Dokumentation kann aktuelle Inhalte wie README, Changelog und Lizenz direkt aus GitHub laden.

Die öffentliche Seite soll möglichst keine manuell duplizierten Versionsdaten enthalten, wenn dieselben Daten aus GitHub Releases ermittelt werden können.

Ziel:

```text
GitHub Release
     │
     ├── README
     ├── Versionsbadge
     ├── Changelog
     └── Projekt-/Dokumentationsseite

=> überall derselbe Versionsstand
```

---

## 12. CI-eigene Commits

Mehrere Workflows können Dateien aktualisieren, beispielsweise:

- Versionsbadge
- Changelog
- Screenshots

Diese Commits sollen klar erkennbar sein.

Beispiele:

```text
README: aktuelle Release-Version [skip ci]
Docs: Changelog für aktuelles Release aktualisieren [skip ci]
README: aktuelle UI-Screenshots ...
```

KI-Tools sollen solche Commits nicht fälschlich als Produktfeature interpretieren.

---

## 13. Was bei einem Dependency-Update passiert

Empfohlener Normalfall:

```text
Dependabot / Entwickler / KI
        │
        ▼
Dependency-Änderung
        │
        ▼
Build + Security
        │
   ┌────┴────┐
   │         │
 grün       rot
   │         │
   ▼         ▼
LKG neu    Rollback-Sicherheitsprüfung
             │
       ┌─────┴─────┐
       │           │
   sicher       Branch schon
   rollback     weiterentwickelt
       │           │
       ▼           ▼
 Revert-Commit   nichts überschreiben
```

Ein fehlgeschlagenes Dependency-Update kann anschließend durch einen Entwickler oder ein KI-Tool sauber migriert werden.

---

## 14. Was KI-Tools vor Änderungen prüfen müssen

Vor Änderungen an Build, Release oder Dependencies:

1. Dieses Dokument lesen.
2. Aktuellen Branch prüfen.
3. Betroffene Workflow-Dateien vollständig lesen.
4. `package.json` und Lockfiles prüfen.
5. Bestehende Tests und Build-Skripte prüfen.
6. Abhängigkeiten zwischen Workflows beachten.
7. Keine Schutzprüfung nur deshalb entfernen, weil sie rot ist.
8. Keine Tests deaktivieren, um einen grünen Status zu erzwingen.
9. Keine Secrets in Dateien schreiben.
10. Keine Git-Historie automatisch force-resetten.
11. Nach Workflow-Umbenennungen alle `workflow_run.workflows`-Referenzen aktualisieren.
12. Nach Änderungen relevante Workflows tatsächlich laufen lassen bzw. deren Ergebnis prüfen.

---

## 15. Was Entwickler/KI NICHT tun sollen

Nicht:

```text
- Buildfehler durch Entfernen des Tests „beheben“
- Security-Checks kommentarlos deaktivieren
- npm --force / legacy-peer-deps dauerhaft als Reparatur einsetzen
- Android-Signing-Secrets committen
- Keystores ins Repository legen
- last-known-good auf einen ungeprüften Commit setzen
- automatisch Force-Push auf den Entwicklungsbranch durchführen
- CHANGELOG-Automatikmarker löschen
- Screenshot-Automatik entfernen, nur weil Screenshots unverändert sind
- Versionsnummern an mehreren Stellen manuell auseinanderlaufen lassen
- Releases erstellen, obwohl zentrale Build-Artefakte fehlschlagen
```

---

## 16. Fehlerbehandlung

Bei einem roten Workflow zuerst den **konkreten fehlgeschlagenen Job und Step** analysieren.

Nicht aus einem roten Gesamtstatus automatisch schließen, dass der gesamte Code falsch ist.

Beispiele:

```text
Android packageRelease rot
=> Signing / Gradle / APK Packaging prüfen

Screenshot Job rot
=> Screenshot-/Demo-Infrastruktur prüfen
=> nicht automatisch Produktcode zurückbauen

Release Health rot
=> prüfen, ob Release-Datei fehlt oder öffentlicher Dienst nicht erreichbar ist

Security rot
=> konkrete Vulnerability/Secret-Fundstelle untersuchen
```

---

## 17. Aktuelle wichtige Dateien

```text
.github/workflows/build.yml
.github/workflows/last-known-good.yml
.github/workflows/release-badge.yml
.github/workflows/changelog.yml
.github/workflows/release-health.yml
.github/workflows/security.yml
.github/dependabot.yml
CHANGELOG.md
README.md
CONTRIBUTING.md
AI_HANDOVER.md
docs/WORKFLOWS.md
```

Weitere Workflow-Dateien können existieren. Diese Liste ist keine Erlaubnis, unbekannte Workflows zu ignorieren oder zu löschen.

---

## 18. Wartung dieses Dokuments

Wenn sich die CI/CD-Architektur wesentlich ändert, muss `docs/WORKFLOWS.md` im selben Arbeitsschritt aktualisiert werden.

Das gilt insbesondere bei:

- neuen oder entfernten Workflows,
- geänderten Workflow-Namen,
- Änderungen am Release-Prozess,
- Änderungen an `last-known-good`,
- Änderungen an Rollback-Regeln,
- neuen Release-Artefakten,
- Änderungen der Branch-Strategie,
- neuen Security-Gates,
- Änderungen der Screenshot-/Dokumentationsautomatik.

### Ziel

Ein neuer Entwickler oder ein KI-Agent soll nach dem Lesen dieses Dokuments verstehen:

1. **welcher Workflow wofür zuständig ist,**
2. **welche Workflows voneinander abhängen,**
3. **was bei Erfolg und Fehler passiert,**
4. **wie Releases dokumentiert und kontrolliert werden,**
5. **welche Schutzmechanismen niemals versehentlich entfernt werden dürfen.**

---

**AnMaCha Cast CI/CD-Dokumentation – diese Datei beschreibt die beabsichtigte Workflow-Substanz und ist bei Architekturänderungen mitzupflegen.**
