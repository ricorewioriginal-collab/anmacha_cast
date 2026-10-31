# AnMaCha Cast – REST-API

Die API steuert alles, was auch das Studio und die Apps können: Sender, Bibliothek, Warteschlange und Decks, Planung,
Aufnahme, Podcast, KI-Werkzeuge, Hörer-Interaktion und den Betrieb des Servers. **Jede Funktion der Oberfläche ruft diese
API auf** – es gibt keine versteckte Zweitschnittstelle.

| Zum Nachschlagen | Wo |
|---|---|
| **Alle Endpunkte** (nach Bereichen, mit Recht und Beschreibung) | [API-REFERENCE.md](API-REFERENCE.md) |
| **Interaktiv** (suchen, aufklappen, ausprobieren) | `https://<server>/api-docs.html` |
| **Maschinenlesbar** (OpenAPI 3.1, für Code-Generatoren und Postman) | [openapi.json](openapi.json) · live `https://<server>/api/v1/openapi.json` (ohne Anmeldung) |
| Webhooks und Brücken zu Icecast/AzuraCast/laut.fm | [BRIDGE.md](BRIDGE.md) |
| Podcast-Feed und kostenlose Hoster | [PODCAST_HOSTING.md](PODCAST_HOSTING.md) |

Referenz und Spezifikation werden aus dem laufenden Code erzeugt (`npm run docs:api`); ein Test schlägt fehl, wenn eine
Route nicht beschrieben ist oder die Dateien veraltet sind. Was hier steht, stimmt also mit dem Server überein.

## Grundlagen

- **Adresse:** `https://<server>/api/v1/…`. Antworten sind JSON (UTF-8), Eingaben JSON mit `Content-Type: application/json`;
  Audio, Bilder und Dateien werden als Rohdaten im Body gesendet (z. B. `PUT /stations/{id}/media?name=Titel.mp3`).
- **Anmeldung:** Header `Authorization: Bearer <Schlüssel>`. Nur für GET geht auch `?token=` (für `<audio>` und Server-Sent Events).
- **Begrenzung:** 120 Anfragen pro Minute und Schlüssel, danach `429`.
- **Fehler:** `{ "error": "<code>", "message": "…" }` mit passendem Status: `400` ungültig, `401` nicht angemeldet, `403` Recht fehlt,
  `404` nicht gefunden, `409` Konflikt, `413` zu groß, `415` Dateityp, `429` zu viele Anfragen.
- **Mehrere Sender:** Fast alle Pfade liegen unter `/stations/{id}/…`. Ein Schlüssel sieht nur die Sender, für die er gilt.
- **Gesundheit:** `GET /api/v1/health` (ohne Anmeldung) für Überwachung und Load-Balancer.

### Drei Arten von Zugangsdaten

| Art | Wofür | Erzeugen | Widerrufen |
|---|---|---|---|
| **API-Schlüssel** (`ad_…`) | Eigene Werkzeuge, Skripte, OBS, Stream Deck | Studio → *Mein Profil & API* → *Neuer API-Schlüssel*, oder `POST /me/tokens` | `DELETE /me/tokens/{id}` |
| **Sitzungs-Token** | Studio im Browser | `POST /auth/login` mit Benutzername und Passwort | `POST /auth/logout` |
| **Geräte-Token** | Apps (Android, Windows) | Kopplungscode einlösen, siehe unten | Studio → Benutzer & Rollen → Geräte, oder `DELETE /devices/{id}` |

Ein persönlicher Schlüssel hat nie mehr Rechte als das eigene Konto, gilt nur für die eigenen Sender und wird ungültig, sobald das
Konto gesperrt oder gelöscht wird. Administratoren legen unter *Benutzer & Rollen → API-Tokens* zusätzlich Sender-unabhängige
Schlüssel an (`POST /tokens`).

### Rechte (Scopes)

Jeder Endpunkt nennt in der Referenz das Recht, das er braucht. „Nur lesen“ bei einem Schlüssel enthält ausschließlich `…:read`.

| Recht | Erlaubt |
|---|---|
| `now_playing:read` | Aktuellen Titel, Verlauf und Statistik lesen |
| `schedule:read` | Sendeplan und Planung lesen |
| `stream:read` | Streams anhören |
| `branding:read` | Sender, Namen und Logos lesen |
| `queue:read` | Warteschlange, Playlists, Posteingang lesen |
| `queue:write` | Warteschlange und Playlists ändern, Posteingang bearbeiten |
| `cardwall:read` | Cardwall lesen |
| `cardwall:trigger` | Cardwall-Tasten, Carts und Schnellstarts auslösen |
| `sources:read` | Quellen und Brücken lesen |
| `sources:write` | Quellen und Brücken ändern, Live-Übernahme |
| `automation:read` | Automation, Planung, Aufnahmen, Podcast und Statistik lesen |
| `automation:write` | Automation steuern, Planung, Aufnahme und Podcast ändern |
| `media:read` | Bibliothek lesen |
| `media:write` | Bibliothek ändern, Titel hochladen und bearbeiten |
| `stations:write` | Sender, Umfragen, Formulare und Hörerbereich ändern |
| `outputs:read` | Ausgänge und Streams lesen |
| `outputs:write` | Ausgänge und Streams ändern |
| `audit:read` | Audit-Protokoll lesen |
| `tokens:write` | API-Schlüssel und Geräte-Kopplung verwalten |
| `lautfm:read` | laut.fm-Anbindung lesen |
| `lautfm:write` | laut.fm-Anbindung ändern |
| `ai:read` | KI-Einstellungen und Verlauf lesen |
| `ai:write` | KI-Funktionen nutzen und einstellen |
| `bridge:write` | Brücken-Schnittstelle für externe Systeme nutzen |

Rollen fassen Rechte zusammen: **Administrator** (alles), **Sendeleitung** (alles im Sendebetrieb, keine Benutzer und Schlüssel),
**Redaktion** (Bibliothek, Playlists, Planung, KI), **Moderation** (live gehen, Carts, Warteschlange) und **Zuschauer** (nur lesen).

## Apps und Geräte

Die Android-App (Go Live, Studio, Sender-Admin) und die Windows-App sprechen dieselbe API. So verbindet sich ein Gerät:

1. **Server finden:** `GET /discover` sucht weitere AnMaCha-Cast-Server im Netz; die App kann auch die Adresse oder den QR-Code
   aus `GET /app/connect` verwenden.
2. **Kopplungscode erzeugen** (am Server, Recht `tokens:write`): `POST /pairing` mit `{ "role": "dj", "stationIds": ["main"] }`
   liefert einen 6-stelligen Code, fünf Minuten gültig, einmal einlösbar. Rollen für Geräte: `operator`, `dj`, `editor`, `viewer`.
3. **Code einlösen** (am Gerät, ohne Anmeldung): `POST /pair` mit `{ "code": "123456", "name": "Handy", "platform": "android" }`
   liefert das **Geräte-Token**. Nach wiederholten Fehlversuchen wird die Adresse zehn Minuten gesperrt.
4. **Danach** läuft alles mit `Authorization: Bearer <Geräte-Token>`. Geräte erscheinen unter `GET /devices` und lassen sich einzeln widerrufen.

Was die Apps nutzen:

| Funktion | Endpunkte |
|---|---|
| Live senden (Browser/App) | `POST /stations/{id}/sources/{src}/takeover`, `…/chunks`, `…/health`, `…/release` |
| Aktueller Titel, Warteschlange | `GET …/now-playing`, `GET/POST …/queue`, Ereignisse unter `GET /events?station={id}` |
| Decks, Playout, Cart-Wand | `POST …/decks/{A–D}/{aktion}`, `PATCH …/playout`, `POST …/cardwall/{slot}/trigger` |
| Verbindung wechseln, Update | `GET /discover`, `GET /update/apk`, `GET /download/AnMaCha-Cast-Android.apk` |

Der **Sender-Admin** der Android-App (laut.fm Radioadmin) ruft die laut.fm-API direkt auf (`api.radioadmin.laut.fm`); der Server
reicht diese Aufrufe für das Studio mit dem gespeicherten Token durch (`/stations/{id}/lautfm/ra/…`, Rechte `lautfm:read` und `lautfm:write`).
Grundlage ist die offizielle Spezifikation „laut.fm Radioadmin-Api“ 1.0.1 (https://docs.api.radioadmin.laut.fm/, abgeglichen mit
`docs/lautfm/radioadmin-api.json` im AnMaCha Control Center). Für Stabilität gilt bei der Durchreichung und bei serverseitigen Aufrufen
(`src/server/lautfm.ts`): Lesezugriffe werden bei 429/502/503/504 oder Netzfehlern bis zu dreimal wiederholt (Retry-After 1–5 s),
Schreibzugriffe nie; nach 401/403 ermittelt der Server den Origin neu und wiederholt einmal, sofern kein Body schon gesendet wurde.
Fehlerantworten von laut.fm behalten ihren Inhalt (`messages`) und bekommen `message` (deutsch) und `lautfm: true`.
Die App-Anmeldung bei laut.fm läuft über `anmachacast://lautfm`.

## Live-Ereignisse

`GET /api/v1/events?station={id}` liefert Server-Sent Events (`now_playing`, `queue.changed`, `podcast.changed`, `inbox.changed`,
`community.changed`, `site.changed`, …). Zum Mitlesen reicht `curl -N -H "Authorization: Bearer $KEY" "https://<server>/api/v1/events?station=main"`.

## Streams, Statusdateien und Quell-Eingang

Außerhalb von `/api/v1`:

| Pfad | Zweck |
|---|---|
| `/status.json`, `/status/{sender}.json` (auch `.xml` im Icecast-Format, `.m3u`, `.xspf`) | Öffentlicher Stream-Status für Webseiten und Player |
| `/listen/{sender}/{mount}` | Stream hören (Recht `stream:read`) |
| `/hls/{sender}/…` | HLS-Playlist und Segmente der Zusatz-Streams |
| `PUT /ingest/{sender}/{mount}` | Icecast-kompatibler Eingang für Encoder (auch Methode `SOURCE`), HTTP Basic mit dem Quell-Passwort |
| `/download/AnMaCha-Cast-Android.apk` | Android-App direkt vom eigenen Server |

Der öffentliche Podcast-Feed liegt unter `/api/v1/public/stations/{id}/podcast.xml`, die Hörer-Funktionen (Wünsche, Nachrichten,
Abstimmungen, Umfragen, Formulare, Sprachnachrichten) unter `/api/v1/public/stations/{id}/listener/…` – beides ohne Anmeldung.

## Beispiele

```bash
KEY=ad_…           # API-Schlüssel
API=https://radio.example/api/v1

# Wer bin ich, welche Sender sehe ich?
curl -H "Authorization: Bearer $KEY" $API/me
curl -H "Authorization: Bearer $KEY" $API/stations

# Titel suchen und einreihen
curl -H "Authorization: Bearer $KEY" "$API/stations/main/media?q=sommer&limit=1"
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"mediaId":"med_abc123"}' $API/stations/main/queue

# Titelanzeige für die Ausgänge von außen senden (z. B. aus einer anderen Automation)
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Sommerhit","artist":"Band"}' $API/stations/main/metadata

# Deck B laden, starten und mit 5 % schnellerem Tempo spielen
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"mediaId":"med_abc123"}' $API/stations/main/decks/B/load
curl -X POST -H "Authorization: Bearer $KEY" $API/stations/main/decks/B/play
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"tempo":1.05}' $API/stations/main/decks/B/tempo

# Mitschnitt als Podcast-Episode veröffentlichen
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"recordingId":"rec_abc123","title":"Folge 1"}' $API/stations/main/podcast/episodes

# Live-Ereignisse mitlesen
curl -N -H "Authorization: Bearer $KEY" "$API/events?station=main"
```

```js
// Node.js ab Version 22
const api = (path, init = {}) => fetch(`https://radio.example/api/v1${path}`, {
  ...init, headers: { Authorization: `Bearer ${process.env.KEY}`, 'Content-Type': 'application/json', ...init.headers },
}).then((r) => r.json());
console.log(await api('/stations/main/now-playing'));
```

Code-Generatoren (OpenAPI Generator, Postman, Insomnia) lesen [openapi.json](openapi.json) direkt; die Beschreibungen der Bodies stehen
in der Referenz und in den jeweiligen Fachdokumenten.
