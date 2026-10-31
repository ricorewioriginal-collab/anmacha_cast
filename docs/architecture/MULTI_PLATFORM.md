# Plattformen

## Windows

```
┌──────────── Windows-PC ─────────────────────────────────────────────┐
│ Dienst „AnMaCha Cast Server“ (Session 0)   AnMaChaCast.exe (natives Fenster) │
│  Core · API · SQLite · Encoder ◄─HTTP─► WPF: Sender/On-Air/Modus,   │
│  Ausgänge ins Internet                  Decks A–D, Cardwall         │
│                                         Mithören/CUE (Soundkarte)    │
│                                         Mikrofon ─► Ingest an Core   │
│ Tray-Symbol: Studio öffnen · Status · Beenden/Neustarten des Dienstes│
└─────────────────────────────────────────────────────────────────────┘
```

Das Windows-Programm (`apps/windows/`, Projekt `AnMaChaCast.csproj`, AssemblyName `AnMaChaCast`) ist **kein Browser-in-der-Box**: Das Hauptfenster
(`MainWindow`) ist natives WPF mit Navigation links und echten Windows-Bedienelementen. Es verbindet sich mit der **eingebauten Engine dieses PCs**
oder mit **entfernten AnMaCha-Cast-Servern** (Kopplungscode oder Anmeldung, Zugangsdaten per Windows-DPAPI geschützt) und spricht dieselbe
REST-/SSE-Schnittstelle wie Studio und Android-App (`docs/API.md`).

**Optik = Web-Studio, aber eigenständig:** Aufbau und Aussehen folgen `studio/styles.css` – Seitenleiste mit Wortmarke, rotem LIVE-Knopf und
Abschnitten (Überblick, Programm planen, KI & Automatik, Musik & Inhalte, Sender & Ausspielung, Analyse, System), Kopfzeile mit Senderwahl samt
Logo/Slogan, ON-AIR-Anzeige, „Jetzt läuft“ (`…/now-playing`), Betriebsart Manuell | 24/7 AutoDJ, MIC LIVE, Sendung starten/stoppen
(`Ui/OnAirBar.cs`, auf jeder Seite), Uhr mit Verbindungspunkt, Statusleiste unten, dunkle Titelleiste. Farben sind die CSS-Variablen aus `:root`; Panels, Knöpfe, Felder,
Listen, Reiter, Bildlaufleisten, Decks (Farbe je Deck A–D) und Cardwall sind ihnen nachgebaut. Die Stile der Bedienelemente stehen in
`apps/windows/Ui/Theme.xaml` und werden zur Laufzeit geladen (`Ui/Theme.cs`), nicht vom XAML-Compiler übersetzt. Ändert sich das Design des
Web-Studios, werden Farben/Formen dort und in `Ui/Kit.cs`/`Ui/Theme.xaml` gemeinsam nachgezogen. Fällt das Laden aus, läuft das Programm mit
Windows-Standardoptik weiter.

| Seite | Umfang (nativ) |
|---|---|
| **Studio** | (On-Air, Betriebsart, Mikrofon, Sendung: Kopfzeile) Decks A–D (Play/Pause/Stopp/Auswerfen, ±10 s, Tempo, Titel laden); Cardwall (auslösen, belegen, leeren); Warteschlange (einreihen, verschieben, mischen, auffüllen, leeren) |
| **Mediathek** | Suchen/Filtern, Hochladen (mehrere Dateien), Bearbeiten, Löschen, Vorhören, in Warteschlange oder auf ein Deck |
| **Playlists** | Anlegen, Umbenennen, Löschen, Titel hinzufügen/entfernen/verschieben, sofort spielen, mischen |
| **Planung & Aufnahme** | Aufnahme starten/stoppen, Mitschnitte (speichern, Podcast-Episode, Nextcloud), automatische Aufnahmen, Sendeplan, Uhr-Ereignisse (an/aus, auslösen), Aufgaben, Motion-Mix-Videos |
| **Ausgänge & Quellen** | Ausgänge (Icecast, SHOUTcast, laut.fm), Zusatz-Streams und Encoder-Profile mit Zeitfenstern, Test, Live-Quellen (Priorität, Übernahme, Encoder-Passwort), Brücken |
| **Einstellungen** | Automation und Audio/Playout (Überblendung, Lautheit, Mikrofon, Encoder – jeder Wert über den Einstellungs-Editor), Smart-Blöcke, Rotationspool, Nachrichten & Wetter, Integrationen, Nextcloud |
| **Podcast** | Feed-Adresse, Einstellungen/Auto-Veröffentlichung, Cover, Episoden, öffentliche Adresse prüfen, Upload zu Buzzsprout/Podbean |
| **Statistik** | Zeiträume, Kennzahlen, Gespielt, Top-Listen, Hörer-Verlauf, CSV |
| **Hörer** | Posteingang (einreihen/erledigen/löschen), Umfragen, Einstellungen des Hörerbereichs |
| **KI** | Assistent mit Verlauf; Anbieter & lokale KI (lokale Server suchen und übernehmen, Vorlagen für Cloud-Anbieter, eigene Anbieter mit Key-Header, Zusatz-Headern, Query) |
| **laut.fm** | Token verbinden, Prüfung, laut.fm-Station wählen, Playlists/Hörer/Station aus dem Radioadmin |
| **Server & Geräte** | Server wechseln/hinzufügen/suchen, Geräte koppeln und entfernen, Netzwerkzugriff erlauben |
| **System** | Zustand, Updates, Sicherungen, Benutzer, eigene API-Schlüssel, Protokoll, Neustart |
| **Cast Tools** | Originale ArtCraft-Anwendungen unter eigenem Namen (Cast Sound, Photo, Film, Vector, Word, Effect): „Am PC öffnen“ lädt die portable Desktop-Fassung beim ersten Mal aus dem offiziellen Release (SHA256 geprüft) nach `%LOCALAPPDATA%\AnMaChaCast\tools`; „Im Browser“ öffnet die Web-Fassung des Servers (`/tools/<id>/`, CSP-Sandbox) |
| Voice Studio (Wellenform-Schnitt), MusicHub, Einrichtungsassistent | **WebView2** – „Weitere Funktionen im Studio …“ öffnet das Web-Studio des aktiven Servers in einem eingebetteten Fenster (`BrowserForm`); beim ersten Start bietet die App den Einrichtungsassistenten selbst an |

**Ohne Server nutzbar:** Die Engine läuft lokal auf dem PC (Automation, Playout, Streams, Aufnahme, Podcast, API); entfernte Server sind nur eine Option. Tray-Symbol, Prozessüberwachung der Engine und Einzel-Instanz-Logik (`Program.cs`, `Engine.cs`) sind unverändert. Live-Senden vom Mikrofon eines
*entfernten* Servers übernimmt die Android-App („Go Live“); am PC läuft das Mikrofon über die Engine (Schalter „Mikrofon“).

**Qualitätssicherung ohne Windows-Rechner:** Die Oberfläche wird im Code gebaut (kein XAML). `apps/windows/check` übersetzt denselben Quellcode unter Linux
gegen die .NET-Framework-4.8-Referenzen, `apps/windows/tests` prüft die oberflächenfreie Logik (`Logic/`: JSON-Lesen, Formate, Server-Profile).
Beides läuft im Job „test“; der Job „windows“ baut danach das echte Programm. Dort öffnet `AnMaChaCast.exe --snapshot <Ordner>` jede Seite einmal,
speichert sie als PNG (Artefakt „AnMaCha-Cast-Windows-Screenshots“) und endet mit Exit-Code 2, wenn `Theme.xaml` nicht geladen werden konnte – so fallen
Fehler im Design auf, die die Linux-Übersetzung nicht sehen kann.

**Wichtig, Session-0-Isolation:** Ein Windows-Dienst hat keinen verlässlichen Zugriff auf die Soundkarte und das Mikrofon des angemeldeten Benutzers. Daraus folgt:
- **Senden** (Dekodieren, Mischen, Kodieren, Streamen) braucht keine Soundkarte und läuft im Dienst.
- **Mithören, CUE und Mikrofon** laufen im Studio-Client beim Benutzer. Das Mikrofon geht als Live-Quelle in den Core und wird dort dekodiert und gemischt.
- Wer ausdrücklich über die Soundkarte **ausspielen** will (etwa UKW-Sender am Line-Out), nutzt den **Einfach-Modus ohne Dienst** (Hintergrundprozess mit Tray, wie heute). Der Installer bietet beide Varianten an.

## Linux

Server bzw. Core als systemd-Dienst. Ein Linux-Desktop-Client ist der Browser oder eine spätere Desktop-Hülle mit derselben Oberfläche. Es gibt keine eigene Linux-Oberfläche.

## Android

Nicht nur eine WebView. Die Oberfläche bleibt Web (dieselbe wie auf dem Desktop), dazu kommen **native Module**:

| Modul | Zweck |
|---|---|
| Serververbindung | Erkennung (UDP), QR-Kopplung, Verbindungstest, Profile, Token im Android Keystore |
| Live-Sender (Foreground-Service mit Benachrichtigung) | Mikrofon → nativer Encoder (AAC über MediaCodec) → an den AnMaCha-Cast-Ingest **oder direkt** an Icecast/laut.fm (Standalone). Läuft weiter, wenn die App im Hintergrund ist |
| Audio | Mithören über den nativen Player (weiterläuft im Hintergrund) |
| Berechtigungen | Mikrofon, Benachrichtigungen, Netzwerk, sauber abgefragt |

Android wird **kein** 24/7-Automationsserver. Das System erlaubt keinen dauerhaften Hintergrundbetrieb dieser Art verlässlich. Der Foreground-Service gilt nur für Live-Sendungen und Mithören.

## Sync (Hybrid)

Der lokale Core arbeitet immer mit seiner eigenen SQLite-Datenbank. Der Abgleich mit dem Server läuft über das Änderungsprotokoll (`sync_changes`: Tabelle, Schlüssel, Änderungszeit, Herkunft). Bei Konflikten gewinnt die neuere Änderung pro Datensatz, der Konflikt wird protokolliert und im Studio angezeigt. Das ersetzt die bisherige Komplett-Blob-Replikation.
