# Streaming, Klang & Liquidsoap

## Sendeweg

Alle Quellen laufen durch **einen Sendebus** je Sender. Nach außen gibt es damit ein festes Format: Wechselt die Quelle (Automation → Live → Automation), bleiben Format und Verbindung der Ausgänge gleich. Hörer-Player brechen nicht ab, und SHOUTcast oder laut.fm bekommen nie plötzlich WebM.

```
Automation (Titel)      ─ffmpeg-Decoder─┐
Carts/Jingles           ─ffmpeg-Decoder─┤
Live-Encoder (BUTT …)   ─ffmpeg-Decoder─┤─► Mixer (Überblendung nach Source Priority, Crossfade, Ducking)
Studio-Mikrofon, App    ─ffmpeg-Decoder─┤     → Master-DSP (Rumpelfilter, EQ, Multiband, Kompressor, AGC, Limiter)
Relay/Stream (Brücke)   ─ffmpeg-Decoder─┘     → Encoder (LAME/AAC/Opus) → Ausgänge (Icecast, SHOUTcast, laut.fm), Recorder, Mithören
```

- Die **Source Priority Engine** entscheidet, welche Quelle hörbar ist. Der Mixer blendet über (Standard 400 ms), statt Rohdaten umzuschalten.
- Live-Quellen werden kurz gepuffert (300 ms gegen Netzwerk-Jitter, höchstens 1,5 s Verzögerung). Formate: MP3, Ogg/Opus, WebM/Opus (Browser-Mikrofon, Android-App), AAC.
- **Live ohne laufende Automation:** Verbindet sich eine Live-Quelle, während der Sendebus aus ist, startet AnMaCha Cast ihn automatisch (Betriebsart LIVE, Automation pausiert) und beendet ihn mit der Live-Sendung wieder.
- Ohne ffmpeg gibt es keinen Sendebus. Dann wird wie früher der Strom der aktiven Quelle unverändert weitergereicht (Notbetrieb). Mit dem mitgelieferten ffmpeg tritt das nicht auf.

## Betriebsarten (Mode-Manager)

| Betriebsart | Wer bestimmt den Ton | Automation | Titelanzeige |
|---|---|---|---|
| **AUTO** | Automation | spielt Queue, Sendeuhr und Sendeplan | laufender Titel |
| **MANUELL** | Operator: Titel mit ▶ „Jetzt senden“, Cartwall | pausiert, startet keinen Titel selbst, die Queue bleibt unangetastet | manuell gestarteter Titel |
| **LIVE** | Live-Quelle (automatisch, sobald sie laut Priorität auf Sendung ist) | pausiert, verbraucht keine Titel. Der laufende Titel wird ausgeblendet | „Live: <Quelle>“ |
| **NOTFALL** | Notfall-Ordner | nur Notfall-Material, weil Queue, Sendeuhr und Sendeplan nichts liefern oder die Automation-Quelle wegen Stille ausfiel | Notfall-Titel |

- AUTO und MANUELL wählt der Operator (Studio: Knopf neben ON AIR, API `PUT /api/v1/stations/<sender>/mode`). LIVE und NOTFALL ergeben sich aus dem Sendezustand. Danach gilt wieder die gewählte Grundbetriebsart.
- **Stille:** Ist das Programm eine Live-Quelle, fällt der Sender auf die Automation zurück. Die stille Live-Quelle bleibt abgeschaltet, bis sie neu verbindet. Ist das Programm die Automation, folgt der nächste Titel, sonst eine Backup-Quelle bzw. der Notfall-Ordner.
- Jeder Wechsel löst das Ereignis `MODE_CHANGED` aus (`{ mode, from, base, reason }`) und landet im Audit-Log.

| API | Zweck |
|---|---|
| `GET /api/v1/stations/<sender>/mode` | `{ mode, base, program, bus, live }` |
| `PUT /api/v1/stations/<sender>/mode` `{ "mode": "AUTO" \| "MANUAL" }` | Grundbetriebsart |
| `POST /api/v1/stations/<sender>/onair` `{ "mediaId": "…" }` | Titel sofort senden (nicht während LIVE, dafür gibt es die Cartwall) |

## Encoder

**Verbinden nur auf Knopfdruck:** Encoder (Ausgänge) verbinden erst, wenn sie im Studio mit „Verbinden“ eingeschaltet werden (`PATCH /outputs/<id> { enabled: true }`). laut.fm-Encoder aus Token/Station werden getrennt angelegt. Ein verbundener Encoder ohne Sendesignal zeigt „Wartet auf Signal“.

**Übertragung:** Icecast-Quellverbindung per HTTP PUT mit rohem Datenstrom (kein `Transfer-Encoding: chunked` – Icecast 2.4 entpackt keine Chunks). **Titel in Echtzeit:** bei jedem Titelwechsel, bei Live („Live: <Quelle>“) und manuell; Icecast über `/admin/metadata` mit `charset=UTF-8`, SHOUTcast über `admin.cgi`. Der letzte Titel wird gemerkt und nach dem (Neu-)Verbinden sofort nachgereicht. Ogg/Opus-Streams tragen keine Admin-Metadaten (Icecast-Einschränkung).


| Format | Encoder | Optionen |
|---|---|---|
| MP3 | LAME (libmp3lame) | CBR (Bitrate) oder VBR (Qualität 0–9), Algorithmus-Qualität 0–9 |
| AAC | ffmpeg-AAC (ADTS) | Bitrate |
| Opus | libopus (Ogg) | Bitrate |

Im Windows-Paket und im Docker-Image ist ffmpeg samt LAME und Opus enthalten.

## Automatische Klangoptimierung

- **Lautheitsangleich pro Titel (EBU R128):** Jeder neue Titel wird im Hintergrund gemessen (integrierte Lautheit und True Peak), immer ein Titel nach dem anderen, damit der Sendebetrieb nicht leidet. Beim Abspielen gleicht AnMaCha Cast auf das Ziel an (Standard −16 LUFS), höchstens ±12 dB. Die Spitzen bleiben dabei unter −1 dBTP, mit Limiter gibt es 3 dB Reserve. Ein manuell gesetzter Gain hat Vorrang. Sprachbeiträge bleiben unverändert. Unter „Server-Automation → Einstellungen“ lässt sich die ganze Bibliothek neu messen.
- **Track-Check (im selben Durchlauf):** Digitale Stille am Anfang und Ende (unter −60 dB, mindestens 0,25 s bzw. 0,5 s) wird automatisch als Cue-In/Cue-Out gesetzt. Leise Einblendungen bleiben unangetastet, von Hand gesetzte Cue-Punkte ebenso. Dazu kommen Hinweise auf Übersteuerung, niedrige Bitrate und stille Dateien (⚠ in der Bibliothek, ✂ für automatisch gekürzte Stille). Bestehende Bibliotheken werden einmalig im Hintergrund nachgeprüft.
- **Klangprofile:** Neutral, Musik ausgewogen, Pop/Dance (laut & dicht, Multiband), Wort & Moderation, Klassik/Jazz. Ein Profil setzt EQ und Dynamik als Startpunkt, danach ist alles frei anpassbar.
- **AGC:** Die Summe wird mit `loudnorm` in Echtzeit auf die Ziel-Lautheit geregelt (EBU R128, TP −1,5 dB). Das bringt ein paar Sekunden Verzögerung im Stream, die Pegel bleiben aber gleichmäßig.
- **Multiband:** 5 Bänder (`mcompand`) für einen dichten Radio-Sound.

## Hörer-Interaktion

Pro Sender unter „Hörer“ einschaltbar, standardmäßig aus. Die öffentliche Seite `hoerer.html?s=<sender>` darf in fremde Webseiten eingebettet werden. Die API unter `/api/v1/public/stations/<sender>/listener` erlaubt CORS ohne Anmeldedaten.

| Endpunkt | Zweck | Grenze je Absender |
|---|---|---|
| `GET …/listener` | freigeschaltete Funktionen, Begrüßung | – |
| `GET …/listener/search?q=` | Suche in der Musikbibliothek (max. 30 Treffer) | 60/min |
| `POST …/listener/request` | Musikwunsch `{ mediaId, name?, text? }` | 3 in 10 min |
| `POST …/listener/message` | Gruß `{ name?, text }` | 3 in 10 min |
| `POST …/listener/vote` | Stimme `{ mediaId, up }` | 1 je Titel in 12 h |
| `GET …/listener/charts` | Hörer-Charts | – |
| `POST …/listener/voice?name=&text=` | Sprachnachricht (`audio/*`, max. 3 MB) | 2/h |

Absender werden über einen gesalzenen Hash der IP unterschieden, die IP selbst wird nicht gespeichert. Im Studio: `GET /stations/:sid/inbox`, `POST /stations/:sid/inbox/:id/(queue|done|delete)`, `GET /stations/:sid/inbox/:id/audio`, `GET|PUT /stations/:sid/listener`. Neue Einträge melden sich per SSE als `inbox.new`.

## Liquidsoap (optional)

Wer Liquidsoap nutzen will, etwa auf einem Server mit guter Anbindung oder für viele Ziele, lässt AnMaCha Cast an Liquidsoap senden. Liquidsoap verteilt dann weiter:

1. Stream & Encoder → **LIQ** → Skript herunterladen. Es wird aus den eingerichteten Ausgängen erzeugt.
2. Umgebungsvariablen setzen: `ANMACHA_CAST_LIQ_INPUT_PASSWORD` und `ANMACHA_CAST_LIQ_OUT<n>_PASSWORD`. Passwörter stehen nie im Skript.
3. `liquidsoap anmachacast-<sender>.liq` starten, zum Beispiel mit Docker `savonet/liquidsoap:v2.2.5`.
4. In AnMaCha Cast einen Icecast-Ausgang auf den Liquidsoap-Harbor anlegen (Port/Mount wie gewählt, Benutzer `source`) und die direkten Ausgänge deaktivieren.

Die CI prüft das erzeugte Skript bei jedem Build mit echtem Liquidsoap (`liquidsoap --check`).
