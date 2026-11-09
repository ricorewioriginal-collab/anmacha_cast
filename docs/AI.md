# KI-Automation (AI Radio Director)

AnMaCha Cast kann einen Sender auf Wunsch vollständig von KI moderieren und musikalisch planen lassen. Dafür nutzt es deine eigenen API-Keys oder lokale Modelle. Die KI ist nie Single Point of Failure. Scheitert ein Aufruf, läuft die Sendeuhr weiter und nichts Unfertiges geht auf Sendung.

## Anbieter

| Aufgabe | Anbieter | Hinweise |
|---|---|---|
| Text | OpenAI, Anthropic, Google Gemini | eigener API-Key |
| Text | OpenAI-kompatibel | Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, eigene Proxys; lokal ohne Key |
| Sprache | OpenAI TTS, ElevenLabs | eigener API-Key |
| Sprache | OpenAI-kompatibel | z. B. Kokoro-FastAPI `http://localhost:8880/v1` |
| Sprache | Piper | lokal/offline, Stimme = Pfad zur `.onnx` (z. B. Thorsten) |

### Lokale KI, Cloud-Anbieter und eigene Anbieter

- **Lokal** (eigener PC oder Server, ohne Key, offline): Vorlagen für Ollama, LM Studio, llama.cpp-Server, vLLM, Jan, KoboldCpp,
  text-generation-webui, Kokoro-FastAPI, openedai-speech und Piper. „Lokale KI suchen“ (`POST /api/v1/ai/discover`) fragt die bekannten
  Ports auf diesem PC/Server ab, im Docker-Container zusätzlich `host.docker.internal`, und auf Wunsch einen weiteren Rechner im eigenen
  Netz (Name oder IP). Gemeldet wird nur, was eine echte OpenAI-kompatible Modellliste liefert. Ältere Ollama-Versionen ohne `/v1/models`
  werden über `/api/tags` erkannt.
- **Cloud über API** (Vorlagen, Adresse änderbar): OpenAI, Anthropic, Google Gemini, OpenRouter, Mistral, Groq, DeepSeek, Together,
  Fireworks, Cerebras, xAI, Perplexity, Azure OpenAI (`{resource}`/`{deployment}` selbst ersetzen), OpenAI TTS, ElevenLabs.
- **Eigener Anbieter**: jeder OpenAI-kompatible Dienst mit frei wählbarer Adresse und optional
  - eigenem Key-Header und Vorsatz (Standard `Authorization: Bearer …`, z. B. Azure `api-key` ohne Vorsatz),
  - bis zu 10 Zusatz-Headern („Name: Wert“; `{key}` wird durch den gespeicherten Key ersetzt, damit er geheim bleibt;
    Verbindungs-, Längen-, Content-Type- und Cookie-Header sind gesperrt),
  - Query-Parametern für jeden Aufruf (z. B. `api-version=2024-10-21`).
- Anbieter auf `localhost`, `127.*`, `[::1]` oder `host.docker.internal` gelten automatisch als lokal; ein Rechner im eigenen Netz lässt sich
  von Hand als lokal markieren.
- Verwaltung im Studio (KI → Anbieter & Keys) und in der Windows-App (KI → Anbieter & lokale KI).

- Keys liegen verschlüsselt im Secret-Store (AES-256-GCM) und werden nie angezeigt oder an den Browser geschickt.
- Modell- und Stimmenlisten werden beim Anbieter abgefragt. AnMaCha Cast gibt keine Modelle vor.
- Pro Aufgabe gibt es Primär und Fallback. Fehler, Zeitüberschreitungen, leere Antworten und Ablehnungen des Modells führen zum Fallback, danach zum Überspringen.

## Director (pro Sender)

- **Moderation** nach jedem n-ten Musiktitel. Kontext: Uhrzeit, gerade gelaufener und nächster Titel, letzte Titel, Wetter-/Info-Quellen. Der Text wird gesäubert (kein Markdown, keine Regieanweisungen) und auf die Wortzahl begrenzt. Danach wird er vertont und direkt vor den nächsten Titel gesetzt.
- **Nachrichten zur vollen Stunde** entstehen nur aus hinterlegten Quellen (RSS/JSON/Text). Ohne erreichbare Quelle entfallen sie. Es wird nichts erfunden.
- **KI-Musikplanung:** Die KI wählt aus einer zufälligen Kandidatenliste freier Titel, geschützt durch Rotation und ohne gerade gespielte Titel. Die Antwort wird streng geprüft: nur bekannte Kürzel, keine Doppelten. Optional wird alle n Titel eine Station-ID bzw. ein Jingle eingefügt. Die Sendeuhr springt ein, sobald die Queue leer ist.
- **Freigabe (optional):** Moderationen landen erst nach Prüfung in der Queue. Nach 30 Minuten verfallen sie.
- **Protokoll:** Jede Entscheidung wird im Studio, im Audit-Log und per Live-Ereignis `ai.decision` festgehalten, mit Anbieter, Modell, Kosten und Dauer.
- Alte KI-Sprachdateien werden automatisch aufgeräumt (Einstellung „behalten“).

## Kosten & Budgets

Preise trägst du selbst ein, je 1 Mio. Ein-/Ausgabe-Token bzw. je 1 Mio. Zeichen. Ohne Preis werden nur Token und Zeichen gezählt. Budgets gelten pro Monat und pro Anbieter oder Sender:

- **Warnung:** Eintrag im Audit-Log.
- **Stopp:** Der Anbieter bzw. Sender wird bis Monatsende nicht mehr genutzt. Der Fallback oder die Sendeuhr übernimmt.

## Werkzeuge

- **Assistent:** Spots, Station-IDs, Sendungsideen, Hörergrüße.
- **Voice Studio:** Text vertonen und in die Bibliothek legen (Ordner „KI-Studio“, Kategorie wählbar).

## API

| Methode | Pfad | Recht |
|---|---|---|
| GET/PUT | `/api/v1/ai/settings` | globaler Admin |
| GET | `/api/v1/ai/usage` | globaler Admin |
| GET | `/api/v1/ai/providers/:id/models`, `/voices` | globaler Admin |
| POST | `/api/v1/ai/discover` `{host?}` | globaler Admin |
| GET/PUT | `/api/v1/stations/:sid/ai` | `ai:read` / `ai:write` |
| POST | `/api/v1/stations/:sid/ai/moderation` `{kind: 'break'\|'news'}` | `ai:write` |
| POST | `/api/v1/stations/:sid/ai/music` | `ai:write` |
| POST | `/api/v1/stations/:sid/ai/pending/:id/approve` \| `reject` | `ai:write` |
| POST | `/api/v1/stations/:sid/ai/text` `{prompt}` | `ai:write` |
| POST | `/api/v1/stations/:sid/ai/speech` `{text, title, category}` | `ai:write` |

## Offen (TODO)

- Google-/Azure-TTS und CosyVoice als eigene Sprach-Anbieter (CosyVoice lässt sich über einen OpenAI-kompatiblen Server anbinden)
- Hörerwünsche/Studiomail als Moderationskontext
- Transkription (Speech-to-Text) für Mitschnitte


## KI-Programmchef für laut.fm

Eigenständig in AnMaCha Cast (Port der Kernfunktionen aus dem AnMaCha Control Center, `ai-lautplan.php`/`ai-lautauto.php`). Studio: „KI-Programmchef“ (Tab in „laut.fm verwalten“), Windows-App: Seite „KI-Programmchef“. Server: `src/server/services/programmchef.ts`, Abgleich/Plan in `src/server/programmchef/`.

- **Wunsch → Plan:** Die KI plant Playlisten (Quelle: deutsche/weltweite Charts, KI-Auswahl nach Stimmung/Thema, laut.fm-Pool nach Genre/Jahr, feste Interpreten, vorhandene Playlist) und Sendezeiten. Ohne KI oder bei unbrauchbarer Antwort plant ein Regel-Planer aus Uhrzeiten, Tagen und Anzahl im Text. Eindeutiges aus dem Text („Top 40“, „je 60 Songs“) setzt der Server selbst durch.
- **Titelsuche:** Jeder Kandidat wird erst im eigenen Bestand, dann im öffentlichen laut.fm-Pool gesucht (Suchstufen und Ähnlichkeit wie im Control Center: Zusätze wie „Radio Edit“ und Kooperationen werden erkannt, Erfundenes fällt heraus). Feineinstellungen (Ausschlüsse, Jahre, höchstens N je Interpret) prüft der Server nach.
- **Einspielen:** Playlisten anlegen oder gleichnamige ergänzen, Sendeplan setzen (Basis-Playlist nie in den Einträgen) und gegenprüfen. **Rückgängig** löscht neu angelegte Playlisten, entfernt hinzugefügte Titel und stellt den alten Sendeplan her.
- **Autopilot:** Eine Vorgabe je Sender, Takt 6 h bis wöchentlich. Der Plan wird gemerkt, solange die Vorgabe gleich bleibt (spätestens wöchentlich neu), die Playlisten werden auf die neue Auswahl gebracht. Nach einem Fehler höchstens stündlich neuer Versuch; alles im Protokoll.
- Charts: Deezer („Top Germany“, weltweite Charts), öffentlich ohne Schlüssel.
- Geprüft gegen Radioadmin- und KI-Nachbauten (`test/programmchef.test.ts`), nicht gegen das echte laut.fm.

### Moderationen & Sendeuhr (Teil 2)

`src/server/services/programmchef-spots.ts` (Port aus `ai-lautspots.php`/`ai-lautclock.php`). Je Beitrag: Text (KI; Uhrzeit-Ansage und feste Sender-Ansage auch ohne Text-KI) → Stimme (KI-Sprachanbieter, WAV wird per ffmpeg zu MP3) → **privater** Titel bei laut.fm (`POST /tracks`, Typ jingle) → warten, bis laut.fm ihn verarbeitet hat (neue eigene Titel-ID) → an die laut Sendeplan gerade laufende Playlist hängen → nach dem Abspielen (Beleg `tracks/stats/24h`) aus der Playlist nehmen und löschen; nicht gelaufene verfallen nach 24 h.

- Arten: Moderation (zum laufenden Titel/nächsten Titel, Wetter/Info-Quellen), Uhrzeit-Ansage, Sender-Ansage, Nachrichten & Wetter (KI-Quellen „news“/„weather“).
- Automatik: Takt 1–4× pro Stunde in einer Sendezeit, höchstens N gleichzeitig offen. **Sendeuhr:** feste Minute je Stunde (z. B. :00 Nachrichten, :30 Uhrzeit), wird 4 Minuten vorher erzeugt, je Stunde einmal.
- API `/stations/:sid/programmchef/spots` (GET/PUT), `…/spots/produce`. Studio: Abschnitt im Tab „KI-Programmchef“, Windows: Karte auf der Seite „KI-Programmchef“.
- Geprüft gegen Radioadmin- und KI/TTS-Nachbau (`test/programmchef-spots.test.ts`).

### Playlist-Pflege (Teil 3)

`src/server/services/programmchef-pflege.ts`, reine Logik in `src/server/programmchef/pflege.ts` (Port aus `ai-lautshuffle.php`, `ai-lautsonglist.php`, `ai-lautmanage.php`). Jingles (Art ≠ song oder Tag „Jingle“) und gerade wartende Moderationen bleiben immer an ihrer Stelle; jede Änderung merkt sich den vorherigen Stand („Letzte Pflege rückgängig“).

- **Smart-Mischen:** Songs neu gemischt, gleiche Interpreten möglichst weit auseinander (Mindestabstand bis 4, so groß wie der häufigste Interpret zulässt). Vorschau mit Startwert → „Jetzt mischen“ übernimmt genau diese Reihenfolge. Schreibt die Playlist neu (alle Einträge entfernen, in neuer Reihenfolge einreihen, einmal nachfassen), bis 800 Titel; schaltet das laut.fm-Mischen dafür aus. Alternativ „laut.fm mischt“ (Flag `shuffled`). Automatisch alle 6 Stunden, täglich oder wöchentlich zu einer Uhrzeit, je Takt höchstens ein Smart-Mischen.
- **Songliste → Playlist:** Text mit Zeilen/Kommas/Semikolons, Nummern oder Aufzählungszeichen; Vorspann wie „Folge 44:“ wird zum Namen. Je Eintrag erst „Titel - Interpret“, dann „Interpret - Titel“ im eigenen Bestand und im Pool suchen; Rest korrigiert auf Wunsch die Text-KI (nur sichere Antworten). Übernehmen als neue Playlist oder an bestehende anhängen (optional genau auf diese Liste setzen) – in Listen-Reihenfolge.
- **Aufräumen:** doppelte Titel (gleiche ID oder gleicher Song in anderer Fassung), Interpreten über dem Limit, Flops (unter 60 % des Hörer-Schnitts bei mindestens 2 Ausspielungen, `tracks/stats/24h` und Vortage). Doppelte sind vorausgewählt; doppelt eingetragene bleiben beim Entfernen einmal drin.
- **Sicherung:** alle Playlisten (Titel-IDs in Reihenfolge, Farbe, Beschreibung, Mischen) und Sendeplan, die letzten 5 je Sender, wöchentliche Auto-Sicherung. Wiederherstellen ordnet Playlisten nach Namen zu, legt fehlende an und schreibt den Sendeplan auf die neuen IDs um; als JSON-Datei herunterladen und (auch auf einem anderen Sender) wieder einspielen.
- API unter `/stations/:sid/programmchef/pflege…` (siehe `docs/API-REFERENCE.md`). Studio: Abschnitte im Tab „KI-Programmchef“, Windows: Seite „Playlist-Pflege“.
- Geprüft gegen Radioadmin- und KI-Nachbau (`test/programmchef-pflege.test.ts`).

### Hörer-Funktionen (Teil 4)

`src/server/services/programmchef-hoerer.ts`, reine Logik in `src/server/programmchef/hoerer.ts` (Port aus `ai-lautwish.php`, `ai-lautgreet.php`, `ai-lautvm.php`, `ai-lautjingles.php`). Baut auf dem Hörerbereich auf (`services/listeners.ts`, `hoerer.html`): Wünsche, Grüße und Sprachnachrichten kommen dort an und stehen im Posteingang.

- **Wunschstunde:** Bei verbundenem laut.fm sucht der Hörerbereich im laut.fm-Pool (Titel/Interpret, ohne Jingles und private Titel); gewünscht werden kann nur, was die Suche geliefert hat. Grenzen je Hörer und Tag sowie je Interpret, kein Titel doppelt. Hörer stimmen in der Wunschliste ab. Beim Speichern wird die Playlist „Wunschstunde“ angelegt und zu den gewählten Zeiten in den Sendeplan eingetragen (Konflikte werden gemeldet, „ersetzen“ auf Bestätigung). 45 Minuten vorher baut der Takt sie auf: Wünsche nach Stimmen und Eingang, Füllmusik aus dem Pool (Genre), Jingles der Jingle-Rotation alle N Songs, feste Reihenfolge. Wünsche nach dem Aufbau werden direkt angehängt. Gelaufen = `tracks/stats/24h` oder 20 Minuten nach Ende.
- **Jederzeit wünschen:** Wunsch an die laut Sendeplan laufende Playlist hängen (laut.fm spielt ihn zum nächstmöglichen Zeitpunkt), nach dem Abspielen wieder entfernen (stand er schon drin, bleibt er). Im Studio „Jetzt spielen“ bzw. im Posteingang „Jetzt bei laut.fm einreihen“.
- **Grüße & Sprachnachrichten:** Gruß → KI formuliert kurz (nur Vorname, ohne Links/Mail/Telefon; unpassend → SKIP, nicht gesendet), ohne Text-KI ein fester Satz → Stimme. Sprachnachricht im Original (ffmpeg → MP3). Beides über den Weg der Moderationen (privat hochladen, an die laufende Playlist, nach dem Abspielen löschen). Aus, auf Knopfdruck im Posteingang oder automatisch (höchstens zwei gleichzeitig offen).
- **Jingle-Rotation:** eigene, bei laut.fm als Jingle gekennzeichnete Titel im Wechsel oder zufällig alle N Songs in gewählte Playlisten (jeder Jingle je Playlist einmal, gleichmäßig verteilt, Auswahl rückt weiter); jetzt oder täglich zu einer Uhrzeit. Rückgängig über „Letzte Pflege rückgängig“.
- API unter `/stations/:sid/programmchef/hoerer…`, öffentlich `…/listener/wishes` und `…/listener/wish/vote`. Studio: Abschnitte im Tab „KI-Programmchef“ und Knöpfe im Posteingang, Windows: Seite „Wunschstunde & Jingles“ und „Bei laut.fm senden“ im Posteingang.
- Geprüft gegen Radioadmin- und KI/TTS-Nachbau (`test/programmchef-hoerer.test.ts`).
