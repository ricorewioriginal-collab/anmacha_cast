# Server-Deployment – AnMaCha Universal Deploy

Der öffentliche AnMaCha-Cast-Demo-Stand wird **serverseitig** durch AnMaCha Universal Deploy (`anmacha-deploy`) verwaltet. Die frühere GitHub-Action `.github/workflows/deploy.yml` wurde entfernt. GitHub Actions bleiben für Build, Tests, Releases und weitere CI-Aufgaben zuständig, führen aber nicht mehr den Demo-Serverdeploy aus.

## Aktueller Demo-Ablauf

- Quelle: Branch `main` dieses Repositories.
- Server-Checkout: `/opt/anmachacast-demo`.
- Compose-Datei: `packaging/demo/docker-compose.demo.yml`.
- Compose-Projekt: `demo`.
- Öffentliche Demo: `https://anmachacast-demo.ricorewi-radio.de/`.
- Update-Prüfung: serverseitiger AnMaCha-Deploy-Timer.
- Nach einem neuen Git-Stand werden die Demo-Container über Docker Compose aktualisiert und anschließend per HTTP-Healthcheck geprüft.
- Bereits erfolgreich ausgerollte Commit-SHAs werden gespeichert, damit unveränderte Stände nicht unnötig neu gebaut werden.
- Der Demo-Reset ist **separat** vom Software-Deploy und läuft über den serverseitigen `anmachacast-demo-reset.timer` alle zehn Minuten.

## Betrieb

Die zentrale Deploy-Logik liegt bewusst auf dem Server und nicht in diesem Repository. Serverlokale SSH-Schlüssel, Zugangsdaten und Konfigurationsdateien gehören niemals ins Git.

Der aktuelle Projektstatus kann auf dem Server mit

```bash
anmacha-deploy status anmachacast-demo
```

geprüft werden. Ein manueller Lauf erfolgt mit

```bash
anmacha-deploy deploy anmachacast-demo
```

Build-/Release-Workflows in `.github/workflows/` dürfen nicht mit dem Produktions-/Demo-Deployment verwechselt werden.

## Demo-Daten

Die Demo verwendet ein eigenes persistentes Docker-Volume. Das Zurücksetzen des definierten Demo-Ausgangszustands übernimmt `packaging/demo/reset-demo.sh` über den separaten Reset-Timer. Der Update-Deploy und der Demo-Reset bleiben absichtlich zwei getrennte Aufgaben.
