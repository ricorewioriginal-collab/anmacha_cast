# Android-App und F-Droid

Die Android-App hat drei Betriebsarten:

- **Go Live:** Das Handy sendet direkt zu laut.fm oder Icecast, ohne eigenen Server (Mikrofon mit Push-to-Talk, vier Decks, Nextcloud-Musikpool).
- **Studio:** Fernsteuerung eines AnMaCha-Cast-Servers auf PC oder Server (Decks, Mediathek, Playlists, Planung).
- **Radioadmin:** laut.fm-Verwaltung unterwegs.

## Installation

1. **APK:** `AnMaCha-Cast-Android.apk` aus den [Releases](https://github.com/ricorewioriginal-collab/anmacha_cast/releases/latest) laden und installieren („Unbekannte Apps installieren“ erlauben). Im WLAN geht es auch direkt vom Server: `http://<PC-Adresse>:8750/download/AnMaCha-Cast-Android.apk`.
2. **F-Droid (mit automatischen Updates):** Auf <https://ricorewioriginal-collab.github.io/anmacha_cast/fdroid/> steht ein Link „In F-Droid hinzufügen“. Alternativ in F-Droid, Droid-ify oder Neo Store unter *Paketquellen* die Adresse `https://ricorewioriginal-collab.github.io/anmacha_cast/fdroid/repo` eintragen. F-Droid zeigt beim Hinzufügen den **Fingerabdruck** des Repositorys an; er muss mit dem auf der Seite genannten übereinstimmen. Das ist ein eigenes Repository, nicht der offizielle F-Droid-Katalog.

Die APK aus den Releases und die F-Droid-Version sind mit demselben Schlüssel signiert und lassen sich gegenseitig aktualisieren. Wer früher eine Test-APK (Debug-Signatur) installiert hat, muss die App einmal deinstallieren.

## Mit einem Server koppeln

1. Am PC im Studio **Android-App → „Im Netzwerk erreichbar“** einschalten, AnMaCha Cast neu starten, Firewall für private Netzwerke erlauben.
2. Im Studio oder in der Windows-App **Gerät koppeln** wählen: Es erscheint ein **QR-Code** (und ein 6-stelliger Kopplungscode, 5 Minuten gültig, einmalig).
3. In der App bei „Mit AnMaCha Cast verbinden“ den QR-Code scannen oder Adresse und Code eintippen. Ein Benutzerkonto ist nicht nötig. Gekoppelte Geräte lassen sich im Studio einzeln widerrufen.

Updates: In der App unter **Updates** wird die neue APK über den verbundenen Server geladen.
