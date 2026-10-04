# Server und Docker

Für den 24/7-Betrieb auf einem Server, NAS oder Raspberry Pi 4/5 (64 Bit).

## Docker

```bash
git clone https://github.com/ricorewioriginal-collab/anmacha_cast.git anmachacast
cd anmachacast
echo "ANMACHA_CAST_DB_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d
docker compose logs anmachacast | grep -A1 -e "Admin-Token" -e "Einmal-Passwort"
```

Danach das Studio unter `http://<server>:8750/#token=<Admin-Token>` öffnen. Es starten `anmachacast` und `anmachacast-postgres` (PostgreSQL, nur intern). ffmpeg mit MP3, AAC und Opus ist im Image enthalten.

- **Update:** `git pull && docker compose up -d --build` (Daten bleiben erhalten).
- **Sicherung:** Datenbank mit `docker compose exec postgres pg_dump -U anmachacast anmachacast > anmachacast-db.sql`, Dateien aus dem Volume `anmachacast_anmachacast-data`.
- **Ohne PostgreSQL** ist eine kleine Installation mit SQLite möglich; Einzelheiten stehen in der [Docker-Anleitung](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/docs/DOCKER.md).
- **Von einer Version mit alten Namen (AirDeck) umsteigen:** Volumes vorher kopieren, siehe dieselbe Anleitung.

## Linux (DEB mit systemd)

```bash
sudo apt install ./AnMaCha-Cast-Linux.deb
sudo journalctl -u anmachacast-server -n 50     # Admin-Token / Einmal-Passwort
```

Der Dienst `anmachacast-server` läuft als Benutzer `anmachacast`. Konfiguration: `/etc/anmachacast/anmachacast.conf`, Daten: `/var/lib/anmachacast`, Protokoll: `/var/log/anmachacast`. Standardmäßig ist er nur lokal erreichbar (`127.0.0.1`); für das Netzwerk im Studio-Setup freigeben oder `bind = lan` setzen. Ohne `ffmpeg` läuft der Dienst ohne Automation und Encoder: `sudo apt install ffmpeg` und Dienst neu starten.

## Hinter HTTPS

Mikrofon im Browser (iPhone, Mobil-App) funktioniert nur über HTTPS. Dafür den Server hinter einen Proxy oder Tunnel stellen (z. B. Caddy oder Cloudflare Tunnel). Podcasts brauchen eine öffentliche Adresse, siehe [Podcast-Hosting](https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/docs/PODCAST_HOSTING.md).
