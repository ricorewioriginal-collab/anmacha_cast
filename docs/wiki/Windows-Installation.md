# Windows Installation

Die aktuellen Downloads stehen unter [Releases](https://github.com/ricorewioriginal-collab/anmacha_cast/releases/latest). Funktionen, die erst auf `main` entwickelt werden, sind erst nach dem nächsten Build im Installer enthalten.

## Installer (`AnMaCha-Cast-Setup.exe`)

1. Setup starten und die Sprache wählen (Deutsch/English).
2. Den **Haftungsausschluss** lesen und annehmen.
3. **Installationsart** wählen: *Vollständig* (Studio, Server, Audio-Engine ffmpeg, Android-APK zum Verteilen), *Nur Studio* (Fernbedienung ohne Audio-Engine) oder *Benutzerdefiniert*. Außerdem „nur für mich“ (ohne Adminrechte) oder „für alle Benutzer“. Nur bei „für alle Benutzer“ trägt der Installer die Firewall-Freigabe selbst ein.
4. Optionen: Desktop-Verknüpfung, **im Hintergrund bei der Anmeldung starten (24/7)**, **im Netzwerk erreichbar** (für die Android-App).
5. Datenspeicher wählen: *nur lokal* (Standard), MySQL/MariaDB oder Firebase. Danach startet AnMaCha Cast.

AnMaCha Cast läuft ohne Konsolenfenster im Hintergrund. Im Infobereich der Taskleiste gibt es das Symbol mit **Studio öffnen**, **Protokoll anzeigen** und **AnMaCha Cast beenden**. Deinstallieren geht über *Einstellungen → Apps*; die Daten bleiben erhalten. Der Autostart beginnt erst nach der Benutzeranmeldung; für Betrieb ohne Anmeldung den Linux- oder Docker-Server nutzen.

### Warnung von Windows (SmartScreen)

Programme ohne gekauftes Signaturzertifikat löst Windows eine Warnung aus. Auf **„Weitere Informationen“ → „Trotzdem ausführen“** klicken. Eine Signatur wird automatisch ergänzt, sobald ein Zertifikat hinterlegt ist.

## Portable-Version

`AnMaCha-Cast-Windows-Portable.zip` vollständig entpacken und `AnMaChaCast.exe` starten. Schließt du das Fenster, laufen Automation und Streams im Hintergrund weiter (Symbol im Infobereich). `AnMaChaCast-Headless.cmd` startet nur die Engine ohne Fenster. Musik, Einstellungen und verschlüsselte Passwörter liegen unter `%LOCALAPPDATA%\AnMaChaCast\data`.

## Erster Test (5 Minuten)

1. **Playlist / Archiv → „＋ Ordner“**: einen Musikordner hochladen oder Dateien ins Fenster ziehen.
2. **Server-Automation 24/7 → Start** (oder **AUTO**); mit 🎧 hörst du mit, das Ausgabegerät steht unter **Audio & Geräte**.
3. Für den Sendebetrieb unter **Stream & Encoder → ＋** Icecast, SHOUTcast oder laut.fm eintragen.

## Bei Problemen

- **„Port belegt“:** anderen Port wählen (`set ANMACHA_CAST_PORT=8760`) oder die Anwendung beenden, die ihn verwendet.
- **Kein Ton beim Monitoring:** Automation gestartet? Abspielbarer Titel vorhanden? Im Menü **⋯** „Programm über die Lautsprecher dieses PCs mithören“ aktivieren.
- **Handy erreicht den PC nicht:** „Im Netzwerk erreichbar“ einschalten, AnMaCha Cast neu starten, privates Netzwerk und Firewall-Regel für den Port (Standard 8750) prüfen.

Mehr dazu: [Installationsanleitung im Repository](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/docs/INSTALLATION.md).
