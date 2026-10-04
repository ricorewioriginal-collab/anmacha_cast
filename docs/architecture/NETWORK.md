# Netzwerk und Serververbindung

## Ports

| Port | Zweck | Standard |
|---|---|---|
| 8750/TCP | API, Studio, Live-Ereignisse, Icecast-kompatibler Ingest, Status/Widget | nur `127.0.0.1` (Local), LAN oder alle (Server) |
| 8751/UDP | LAN-Erkennung (nur Antwort auf Anfrage, keine Dauer-Sendung) | nur wenn LAN-Zugriff aktiv |
| 443 | HTTPS über Caddy (Self-Hosted mit Domain) | optional |

## Health und Version

`GET /api/v1/health` ist öffentlich und liefert nur Unkritisches:

```json
{ "status": "ok", "name": "AnMaCha Cast", "version": "1.0.0", "api": "1.0",
  "server": "ok", "database": "ok", "storage": "ok", "audio": "ok", "encoder": "ok", "stream": "connected", "ai": "ready" }
```

Details liefern angemeldet `GET /api/v1/system`, `/database`, `/audio`, `/encoder`, `/stream` und `/ai`.

**Kompatibilität:** Client und Server vergleichen die API-Hauptversion. Weicht sie ab, meldet der Client „AnMaCha Cast Server benötigt ein Update“ bzw. „Diese App benötigt ein Update“ statt eines technischen Fehlers.

## Server hinzufügen (Client)

```
[Dieser Computer]  ──► http://127.0.0.1:8750/api/v1/health  (automatisch beim Start)
[Im Netzwerk suchen] ─► UDP-Broadcast 8751 „ANMACHACAST?“ → Antworten mit Name, Adresse, Version
[QR-Code / Kopplungscode] ─► vom Server erzeugt, 5 Minuten gültig
[Manuell] ─► Host, Port, HTTPS
```

Der Verbindungstest läuft in Schritten, und jeder Schritt meldet ein eigenes Ergebnis:

1. Adresse auflösbar
2. Port erreichbar
3. TLS gültig (bei HTTPS)
4. `/api/v1/health` antwortet als AnMaCha Cast
5. Version kompatibel
6. Anmeldung (Benutzer/Passwort oder Kopplungscode) → Geräte-Token
7. Rechte/Sender abgerufen → **Verbunden**

„Verbunden“ erscheint erst nach Schritt 7. Serverprofile (Name, Adresse, Gerät-Token, zuletzt verbunden) werden gespeichert, das Token im sicheren Speicher der Plattform.

Hinweise, die der Client gezielt gibt, statt „Server nicht erreichbar“:
- Auf dem Handy `localhost`/`127.0.0.1` eingegeben: „Das ist das Handy selbst. Gib die Adresse des PCs ein oder nutze ‚Im Netzwerk suchen‘.“
- Port erreichbar, aber AnMaCha Cast nur lokal freigegeben: Der Server beantwortet die Erkennung und meldet „LAN-Zugriff ist aus – am PC unter Administration → Netzwerk einschalten“.
- Anmeldung abgelehnt, Server hat keine Benutzer: Diesen Fall gibt es nach dem Umbau nicht mehr, weil jede Installation im Setup ein Admin-Konto bekommt (behebt AUDIT 5.1).

## Lokaler Client ↔ lokaler Server

Das Desktop-Studio verbindet sich über `127.0.0.1` und nicht über die LAN-Adresse. Die Anmeldung erfolgt automatisch mit einem Maschinen-Token, das nur von `127.0.0.1` angenommen wird und im Datenverzeichnis des Dienstes liegt. IPC über Named Pipes/Unix-Sockets bringt gegenüber Loopback-HTTP keinen Vorteil und wird nicht eingeführt.

## Web-Fernsteuerung (Browser auf fremder Webseite)

Webseiten wie ein Radio-Control-Center können AnMaCha Cast direkt aus dem Browser bedienen und den Sendebetrieb über `GET /api/v1/events` live mitlesen. Damit der Browser das darf, muss die Webseite freigegeben sein:

- **Studio:** Tools → Web-Fernsteuerung → eine Adresse pro Zeile (nur Origin, z. B. `https://control.meinradio.de`). Erlaubt sind `https://…` sowie `http://localhost`/`127.0.0.1`. Gespeichert in `network.json` (`webOrigins`), sofort wirksam, kein Neustart.
- **API:** `GET`/`PUT /api/v1/app/origins` (`{ "webOrigins": [...] }`, nur globale Admins).
- **Umgebung:** `ANMACHA_CAST_CORS_ORIGINS` (kommagetrennt) wirkt zusätzlich, z. B. für feste Docker-Setups
  .

Die Freigabe ersetzt keine Anmeldung: Die Webseite verbindet sich per Kopplungscode (im selben Dialog erzeugbar, Rolle und Sender wählbar) oder Benutzerkonto und erhält ein widerrufbares Geräte-Token. `EventSource` übergibt das Token als `?token=` (nur bei GET erlaubt).

Für AnMaCha Cast auf diesem PC oder im LAN beantwortet AnMaCha Cast bei freigegebenen Webseiten zusätzlich Chromes „Private Network Access“-Abfrage (`Access-Control-Allow-Private-Network: true`). Ruft eine https-Webseite ein AnMaChaCast im LAN per `http://` auf, blockiert der Browser das trotzdem (Mixed Content). Ausnahme ist `127.0.0.1`/`localhost`. Für andere Rechner im Netz muss AnMaChaCast daher per HTTPS erreichbar sein (siehe unten).

## Fernzugriff über einen Vermittler (ohne Portfreigabe)

Ein AnMaCha Cast hinter einem Router (Studio-PC) ist von außen nicht erreichbar. Deshalb kann AnMaCha Cast selbst eine **ausgehende** HTTPS-Verbindung zu einem Vermittler (Hub) aufbauen, z. B. dem Relay-Dienst eines Radio-Control-Centers. Darüber laufen Anfragen und Live-Ereignisse in beide Richtungen.

- **Studio:** Tools → Fernzugriff → Verbindungscode einfügen (`adl1.…`, erzeugt im Control Center), Rolle und Sender wählen. Status: verbindet / verbunden / Fehler.
- **API:** `GET`/`PUT`/`DELETE /api/v1/app/remote-link` (nur globale Admins). Der Schlüssel aus dem Code und das Geräte-Token liegen nur im Secret Store und erscheinen nie in einer API-Antwort.
- **Protokoll** (nur Bordmittel): `GET <hub>?action=adl_agent&link=<id>` mit Header `X-Link-Key` liefert Server-Sent Events (`req`: `{rid, method, path, body}`); Antworten gehen an `POST …adl_reply` (`{rid, status, body}`), Ereignisse gebündelt an `POST …adl_events`. Wiederverbindung mit wachsendem Abstand (2 s bis 60 s); bleibt der Strom 65 s still, wird neu verbunden.
- **Rechte:** Jede vermittelte Anfrage läuft über die eigene API (Loopback) mit einem eigenen Geräte-Token („Fernzugriff: …“, unter Geräte einzeln widerrufbar). Rolle, Sender, Scopes und Rate-Limit gelten wie bei jedem gekoppelten Gerät. Anmeldung, Tokens/Geräte/Benutzer, `app/*`-Einstellungen, Ereignis-Strom, Neustart, Update, Backup, Speicher und Datenbank sind über den Vermittler grundsätzlich gesperrt. Übertragen werden nur JSON-Antworten bis 2 MB (keine Dateien/Audio).
- **Ereignisse:** Titel, Queue, Betriebsart, Automation, Decks, Sendebus (je Sender nur der neueste Stand), Carts, Streams und Quellen; keine Pegel.
  Für einen Inhaltsabgleich zusätzlich `library.changed`, `playlists.changed` und `planning.changed` – nur als Hinweis „hat sich geändert“, ohne Daten.
- **Sendesignal übergeben (Standard aus):** Ist im Fernzugriff „Sendesignal übergeben erlauben“ eingeschaltet, kann der Vermittler per Ereignis `feed` (`{stationId, on}`) das Programm eines freigegebenen Senders anfordern. AnMaChaCast hängt sich dann wie der Recorder an das Programmziel (`/live`) und schickt das kodierte Signal gebündelt alle 0,5 s per `POST <hub>?action=adl_feed&link=<id>&s=<sender>` (Header `X-Link-Key`, `Content-Type` des Encoders, `X-Feed-Init` mit Container-Header, `X-Feed-End` am Ende). Antwortet der Vermittler mit 404/410, hört AnMaChaCast auf; bei Verbindungsverlust endet die Übergabe und wird nach dem Neuverbinden neu angefordert.
- **Dateien (Inhaltsabgleich):** Eine Anfrage kann `pull` (Datei beim Vermittler holen und per `PUT` an die eigene API geben, z. B. `/stations/<id>/media?name=…`) oder `push` (Datei per `GET` aus der eigenen API lesen und zum Vermittler hochladen) enthalten. Beides ist **nur mit der Adresse des Vermittlers** erlaubt (gleiche Herkunft), höchstens 300 MB; Stream-Titel (Weiterleitung) werden nicht übertragen.

## HTTPS

- **Self-Hosted:** Caddy als Reverse Proxy mit automatischem Zertifikat. Die Vorlage erzeugt der Setup-Assistent aus Domain und E-Mail.
- **LAN:** HTTP ist zulässig, wenn ausdrücklich „nur lokales Netz“ gewählt ist.
- AnMaCha Cast selbst terminiert kein TLS. Das bleibt die Aufgabe des Proxys, der dafür gebaut ist.

## Stand der Umsetzung

| Baustein | Stand |
|---|---|
| Health mit Version und API-Version | umgesetzt (`/api/v1/health`) |
| LAN-Erkennung UDP 8751 (`ANMACHACAST?1` → Name, Version, API, Port, LAN an/aus) | umgesetzt (`src/server/discovery.ts`). Abschaltbar mit `ANMACHA_CAST_DISCOVERY=off`. Suche vom Desktop-Studio über `GET /api/v1/discover`. In der App kommt die Suche mit dem nativen Modul (Schritt 8), weil eine WebView kein UDP senden kann |
| Kopplungscode (6 Ziffern, 5 min, einmalig, Rolle und Sender wählbar, Sperre nach 8 Fehlversuchen je Adresse für 10 min) | umgesetzt: `POST /api/v1/pairing`, öffentlich `POST /api/v1/pair` |
| Geräte-Token, einzeln widerrufbar, „zuletzt gesehen“ | umgesetzt: `GET /api/v1/devices`, `DELETE /api/v1/devices/<id>` |
| Verbindungstest in Stufen mit Hinweisen, Versionsprüfung, Serverprofile | umgesetzt (`studio/js/connect.js`, Dialog „Mit AnMaCha Cast verbinden“, „Server wechseln“) |
| Web-Fernsteuerung (freigegebene Webseiten, CORS + Private Network Access) | umgesetzt: `GET`/`PUT /api/v1/app/origins`, Studio → Tools → Web-Fernsteuerung |
| Fernzugriff über Vermittler (ausgehende Verbindung, eigenes Geräte-Token, gesperrte Admin-Pfade) | umgesetzt: `src/server/services/remote-link.ts`, `GET`/`PUT`/`DELETE /api/v1/app/remote-link`, Studio → Tools → Fernzugriff |
| QR-Code | umgesetzt: Inhalt `<Server-Adresse>/#pair=<6 Ziffern>`. Erzeugt vom Studio (Seitenleiste „Gerät per QR koppeln“, auch hinter Reverse-Proxy/Docker) und von der Windows-App (Server & Geräte → Neues Gerät koppeln, QR nur bei freigegebenem Netzwerkzugriff). Gescannt von der Android-App („Per QR-Code koppeln“, ZXing, ohne Google-Dienste); die Handy-Kamera öffnet den Link im Browser und koppelt dort. |
| Token im Android Keystore | folgt mit Schritt 8, bis dahin Speicher der WebView |


## Kompatibilität mit dem AnMaCha Control Center

Die Verbindungsleiste des Control Centers (`anmacha-cast-connect.js`, eingebunden in `relay-automation.html` und `live.html`) und der Inhaltsabgleich des Relays (`golive-relay/adsync.js`) nutzen nur die öffentliche REST-API. Geprüft gegen das Originalmodul `golive-relay/adlink.js`: Verbindungstest (`/health` mit Name „AnMaCha Cast“ und API 1.x, `/auth/status`, `/pair`, `/me`), Abfragen und Bedienung (`now-playing`, `queue`, `mode`, `playout`, `cardwall`, `media`, `planning`), CORS nach Freigabe unter „Web-Fernsteuerung“, Live-Ereignisse (direkt und über den Vermittler), Fernzugriff mit dem Verbindungscode `adl1.…` und die Dateiübergabe (`pull`/`push`, bit-genau). Die Verträge der Leiste sichert `test/control-center-compat.test.ts` ab; das Sendesignal (`feed`, braucht ffmpeg) ist nicht Teil dieser Prüfung.
