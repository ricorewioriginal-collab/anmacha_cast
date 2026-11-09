# AnMaCha Cast für Android

Native App (Kotlin + Jetpack Compose + Material 3) - kein WebView, kein PWA-Wrapper. Zwei
Betriebsarten, die sich ohne erneute Anmeldung umschalten lassen:

**Studio / Fernsteuerung:** Einen laufenden AnMaCha-Cast-Server fernsteuern (Programm, Warteschlange,
Quellen übernehmen/freigeben), über dieselbe REST-/SSE-API (`/api/v1/...`), die auch das Web-Studio nutzt.

**Go Live:** Das Handy wird selbst zum Sendestudio, mit der bestehenden reinen Java-Engine (`engine/`).
Läuft als Vordergrund-Dienst mit dauerhafter Benachrichtigung weiter, auch bei ausgeschaltetem Bildschirm.
- Mikrofon und Musik vom Handy, Musik unter dem Mikrofon wird leiser (Ducking)
- MP3-Encoder: LAME als reines Java (jump3r, LGPL 2.1+), keine nativen Bibliotheken
- Sendet an laut.fm, Icecast oder AzuraCast (Icecast-Quellprotokoll PUT, bei älteren Servern SOURCE).
  Bei Abbruch verbindet sich die App selbst neu.
- Titelliste mit automatischem Weiterspielen, Mithören über Kopfhörer, Pegelanzeigen

**Menü wie im Web-Studio und in der Windows-App:** Im Bereich Server / Studio führt der Reiter „Menü“ alle Bereiche
mit denselben Abschnitten, Namen und Einfach-/Profi-Ansicht (`more/MenuScreen.kt`). Was die App nativ kann (Live-Studio,
Server, Hörer & Interaktion, KI-Programmchef), öffnet den nativen Bildschirm; alles andere zeigt die Seite des verbundenen Servers in der App
(`common/WebStudioScreen.kt`: eine geteilte WebView, Web-Studio im Einbett-Modus `?embed=`, Mikrofon und Dateiauswahl nur
für den eigenen Server, fremde Links im Browser).

**Nativ im Bereich Server / Studio:** Live-Studio mit Jetzt läuft, Quellen, Warteschlange und Cardwall (abspielen,
alle stoppen); Hörer & Interaktion (`listeners/`: Wünsche, Grüße, Sprachnachrichten, Studiomail – einreihen, auf Sendung,
per Mail antworten, erledigen, löschen); KI-Programmchef (`programmchef/`: Autopilot mit eigener Vorgabe, Takt, jetzt
ausführen, rückgängig, Protokoll).

## Aufbau

- `engine/src`: Engine ohne Android-Bezug (Mischpult, Encoder, Icecast-Quelle, Takt). Wird mit
  `engine/test.sh` gegen einen echten Icecast getestet.
- `native/`: Android-Audio-Schicht (Mikrofon, Decoder, Vordergrund-Dienst `EngineService`,
  `EngineHub` als Fassade für die Oberfläche)
- `app/src/main/kotlin/app/anmachacast/studio/`: die native Oberfläche (Paket `app.anmachacast.studio`)
  - `data/`: REST-Client, SSE-Client (Realtime), verschlüsselte Token-Ablage
  - `connect/`, `home/`, `studio/`, `golive/`, `more/` (Menü), `common/` (eingebettete Server-Seiten): Bildschirme je Bereich
  - `nav/AppNav.kt`: Startbildschirm mit zwei Betriebsarten und dauerhaftem Umschalter oben (`nav/ModeHeader.kt`).
    Go Live (Live, Musik, Sender) funktioniert ohne Server; Server / Studio koppelt erst, wenn man es öffnet.
  - Navigation ohne Back-Stack (`nav/AppNav.kt`): Bereich und Reiter sind einfacher Zustand, Zurück geht erst zum ersten Reiter, dann zum Start.
  - `golive/`: vier Decks (A–D) mit eigenem Puffer im Mischpult (`Decks.kt`), Titel per Menü Decks zuordnen, Dateien und Ordner
    gesammelt importieren. Push-to-Talk (Drücken öffnet das Mikro in ca. 12 ms), Mikrofonquelle, Pegel, Encoder.
  - `radioadmin/`: **Sender-Admin**, der dritte Bereich. laut.fm Radioadmin mobil: Übersicht, Playlists, Titel (suchen, hochladen,
    bearbeiten, Tags, Vorhören, alle Filter der API, Seitenweise nachladen, mehrere Titel auf einmal), Automation-Algorithmen,
    Sendeplan, Statistik inkl. Werbe-Log, Tagesauswahl und Hörstunden, Benutzer, Station mit Logo/Hintergrund/Website-Bild, Live-Zugang.
    Direkt gegen die Radioadmin-API (`RaClient`, Abgleich mit der Spezifikation `docs.api.radioadmin.laut.fm`; reine Logik in
    `RaLogic.kt`), mit derselben laut.fm-Anmeldung wie Go Live (`live/LautFmSession.kt`).
  - `live/`: laut.fm (Anmeldung im Browser mit Rückkehr per App-Adresse `anmachacast://lautfm`, WebView als Ausweg, Token im Adress-Anker, Stationen, Live-Zugangsdaten automatisch)
    und Nextcloud (Login Flow v2, WebDAV, Titel in den Zwischenspeicher). Zugangsdaten liegen verschlüsselt (`LiveStore`).

Ein einziges Gradle-Projekt (keine generierte `android/`-Unterordner mehr wie zu Capacitor-Zeiten) -
`engine/src` und `native/` werden direkt als zusätzliche Quellverzeichnisse eingebunden, nicht kopiert.

## Bauen

Voraussetzungen: JDK 17 und Android SDK (`ANDROID_HOME`) - lokal, oder automatisch über GitHub Actions
(Workflow „Build“, Job `android`, Artefakt `AnMaCha-Cast-Android`, die Runner bringen den Android SDK
bereits mit).

```bash
cd apps/android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

## Verbinden

1. AnMaCha Cast auf dem PC mit Netzwerkfreigabe starten: `ANMACHA_CAST_HOST=0.0.0.0`
2. Im Studio-Dashboard einen Kopplungscode erzeugen (`POST /api/v1/pair`, 6 Ziffern, 5 Minuten gültig).
3. In der App die Server-Adresse (z. B. `https://dein-server:8750`) und den Code eingeben.
