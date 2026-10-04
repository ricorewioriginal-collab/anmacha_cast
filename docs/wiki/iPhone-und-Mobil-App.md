# iPhone, iPad und Mobil-App

Eine native iOS-App ist ohne Apple-Entwicklerkonto (99 €/Jahr) nicht dauerhaft möglich. Deshalb gibt es die **kostenlose Web-App (PWA)** ohne App Store:

1. In **Safari** die Adresse deines AnMaCha-Cast-Servers öffnen (am besten `https://…`).
2. **Teilen → Zum Home-Bildschirm**.

## Mobil-Ansicht

Unter `https://<server>/mobil.html` gibt es die Android-Betriebsarten als Web-App: **Go Live** (Mikrofon als Live-Quelle, Push-to-Talk, Warteschlange), **Studio** (vier Decks, Mediathek, Playlists) und **Radioadmin** (laut.fm-Kurzversion). Ohne eigene Oberfläche kannst du auch <https://ricorewioriginal-collab.github.io/anmacha_cast/app/> öffnen, die Adresse deines Servers und die Anmeldung eintragen.

## Grenzen (iOS-Vorgaben)

- **Mikrofon nur über HTTPS.**
- **Kein Mikrofon im Hintergrund:** Für Live-Sendungen die App im Vordergrund lassen.
- Die Web-App sendet **nicht direkt** an Icecast oder laut.fm, sondern über einen AnMaCha-Cast-Server (Windows-App, Docker, Linux).

Ausführlich: [IOS.md im Repository](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/docs/IOS.md).
