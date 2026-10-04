# AnMaCha Cast – Sicheres paralleles Arbeiten

Diese Datei beschreibt, wie mehrere Entwickler oder automatisierte Entwicklungswerkzeuge gleichzeitig an AnMaCha Cast arbeiten können, ohne Änderungen gegenseitig zu überschreiben.

## Grundprinzip

**Nicht mehrere unabhängige Arbeiten direkt gleichzeitig in denselben Entwicklungsbranch schreiben.** Jede unabhängige Aufgabe bekommt einen eigenen kurzlebigen Arbeitsbranch und wird anschließend über einen Pull Request integriert.

Beispiele:

```text
main
        │
        ├── work/ui-navigation
        ├── work/installer-update
        └── work/backend-refactor
```

Die Namen sind Beispiele. Entscheidend ist die Trennung nach Aufgabe, nicht nach Person oder Werkzeug.

## Warum das funktioniert

Git arbeitet inhaltlich mit Änderungen, nicht nach dem Prinzip „die zuletzt hochgeladene Datei gewinnt“.

Ändert Arbeit A beispielsweise UI-Dateien und Arbeit B Installer-Dateien, können beide Änderungen normalerweise unabhängig zusammengeführt werden.

Wenn beide dieselbe Datei ändern, gibt es drei Fälle:

1. **Unterschiedliche Bereiche/Zeilen:** Git kann die Änderungen häufig automatisch zusammenführen.
2. **Gleiche oder überlappende Bereiche:** Git erzeugt einen Merge-Konflikt. Dieser muss bewusst aufgelöst werden.
3. **Semantischer Konflikt ohne Textkonflikt:** Git kann technisch mergen, aber die Kombination kann funktional falsch sein. Deshalb muss nach dem Zusammenführen CI erneut laufen.

## Niemals „blind überschreiben“

Ein Entwicklungswerkzeug darf eine Datei nicht auf Basis eines alten Standes vollständig ersetzen, wenn sich der Zielbranch inzwischen verändert hat.

Vor Commit/Push/PR-Aktualisierung gilt:

```text
1. aktuellen Zielbranch abrufen
2. eigenen Arbeitsbranch aktualisieren/rebasen oder mergen
3. Konflikte bewusst lösen
4. Build/Tests ausführen
5. erst danach integrieren
```

## Pull Requests als Integrationsgrenze

Jede parallele Aufgabe soll einen eigenen Pull Request gegen

```text
main
```

verwenden.

Dadurch sind Änderungen getrennt sichtbar und können unabhängig getestet werden.

Ein Pull Request darf erst integriert werden, wenn:

- sein Branch auf einem ausreichend aktuellen Zielstand basiert,
- Konflikte aufgelöst sind,
- die relevanten CI-Prüfungen erfolgreich sind,
- keine Änderungen einer parallel laufenden Arbeit versehentlich entfernt wurden.

## Parallel Change Guard

`.github/workflows/parallel-change-guard.yml` prüft bei Pull Requests automatisch, ob andere offene Pull Requests dieselben Dateien verändern.

### Kein Überschreib-Automatismus

Der Guard blockiert Überschneidungen nicht pauschal. Zwei Arbeiten dürfen dieselbe Datei ändern, wenn ihre Änderungen kompatibel sind.

Stattdessen meldet der Workflow die gemeinsam angefassten Dateien sichtbar im Job Summary und erzeugt eine Warnung.

Das ist absichtlich so: Eine Dateiüberschneidung ist ein **Risikosignal**, aber nicht automatisch ein Fehler.

## Beispiel: getrennte Aufgaben

```text
Arbeit A:
src/ui/**
assets/**

Arbeit B:
installer/**
build/**
```

Keine Überschneidung: beide Pull Requests können unabhängig getestet und nacheinander integriert werden.

## Beispiel: gemeinsame Datei

```text
Arbeit A ändert package.json für UI-Abhängigkeit.
Arbeit B ändert package.json für Packaging-Abhängigkeit.
```

Beide Arbeiten sind fachlich unabhängig, berühren aber dieselbe Datei.

Vorgehen:

```text
A wird integriert
        │
        ▼
B aktualisiert seinen Branch vom neuen Zielstand
        │
        ▼
package.json + Lockfile werden zusammengeführt
        │
        ▼
Build + Tests
        │
        ▼
B wird integriert
```

Dabei müssen die Änderungen aus A erhalten bleiben.

## Lockfiles

`package-lock.json` und andere generierte Lockfiles sind besonders konfliktanfällig.

Bei Dependency-Änderungen:

- Manifest (`package.json`) korrekt zusammenführen,
- Lockfile nicht durch Copy/Paste alter Versionen „retten“,
- Lockfile anschließend mit dem vorgesehenen Paketmanager aus dem zusammengeführten Manifest neu erzeugen,
- Installation und Build prüfen.

## Architektur- und Querschnittsänderungen

Große Refactorings können viele Dateien berühren und erhöhen das Kollisionsrisiko.

Wenn gleichzeitig eine kleine isolierte Aufgabe läuft, sollte die kleine Aufgabe möglichst zuerst integriert oder der große Arbeitsbranch regelmäßig mit dem Zielbranch synchronisiert werden.

## CI nach jedem Merge

Auch wenn Git keinen Konflikt meldet, muss der zusammengeführte Stand erneut geprüft werden.

Grund:

```text
Änderung A = einzeln korrekt
Änderung B = einzeln korrekt
A + B       = kann trotzdem inkompatibel sein
```

Deshalb bleibt der normale AnMaCha Cast-Build die technische Integrationsprüfung.

## Beziehung zu Last Known Good

Parallelentwicklung und Rollback sind getrennte Schutzebenen:

```text
Arbeitsbranches + Pull Requests
        │
        ▼
Parallel Change Guard
        │
        ▼
Merge
        │
        ▼
Build
        │
   ┌────┴────┐
  grün      rot
   │          │
   ▼          ▼
LKG neu    Rollback-Logik
```

Der Rollback ist **nicht** dafür gedacht, normale Merge-Konflikte zu lösen. Konflikte müssen vor der Integration sauber aufgelöst werden.

## Regeln für automatisierte Entwicklungswerkzeuge

Ein automatisiertes Entwicklungswerkzeug soll:

1. vor Arbeitsbeginn den aktuellen Zielbranch lesen,
2. für eine unabhängige Aufgabe einen separaten Arbeitsbranch verwenden,
3. nur Dateien ändern, die für die Aufgabe erforderlich sind,
4. keine fremden Änderungen „aufräumen“, nur weil sie nicht zur eigenen Aufgabe gehören,
5. vor Integration den aktuellen Zielbranch erneut einbeziehen,
6. Konflikte nicht durch pauschales Überschreiben einer kompletten Datei lösen,
7. bei Konflikten beide Änderungsabsichten verstehen und erhalten,
8. generierte Dateien aus dem zusammengeführten Quellstand neu erzeugen,
9. relevante Tests/Builds nach der Zusammenführung erneut ausführen,
10. im Pull Request klar dokumentieren, welche Bereiche verändert wurden.

## Empfohlene Commit-Struktur

Commits sollten fachlich begrenzt bleiben.

Gut:

```text
feat(ui): improve studio navigation
fix(installer): preserve user configuration on update
refactor(api): separate station configuration service
```

Ungünstig:

```text
update stuff
many fixes
changes
```

Kleine, verständliche Commits erleichtern Konfliktauflösung, Reverts und Reviews.

## Wichtigste Sicherheitsregel

**Bei konkurrierenden Änderungen niemals „letzter Schreibvorgang gewinnt“ als Strategie verwenden.**

Der gewünschte Ablauf ist:

```text
trennen → vergleichen → zusammenführen → testen → integrieren
```

So können mehrere Arbeiten parallel stattfinden, ohne dass eine vollständige Datei oder ein ganzer Funktionsbereich unbemerkt durch einen älteren Stand ersetzt wird.
