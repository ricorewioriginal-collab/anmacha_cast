# Bekannte Probleme – AnMaCha Cast

Nur aus dem aktuellen Repository eindeutig ableitbare bzw. dort bereits dokumentierte Punkte.

## Runtime-Abhängigkeits-Audit ist noch nicht vollständig
- **Bereich:** Release / Packaging
- **Status:** IN PROGRESS laut `RUNTIME_DEPENDENCIES.md`.
- **Problem:** Exakte Binary-Versionen/Hashes, Abhängigkeitsbäume, Codec-Konfigurationen, Lizenztexte, Herkunft und Updatewege sind noch nicht vollständig als Release-Nachweis erfasst.
- **Nächster Schritt:** Audit gemäß `RUNTIME_DEPENDENCIES.md` vervollständigen; keine vollständige SBOM behaupten.

## Öffentlicher Projektstatus ist weiterhin Beta
- **Bereich:** README / Branding / Release
- **Status:** aktuell dokumentiert.
- **Problem:** README zeigt Beta-Badge und nennt den Projektstatus „Beta“, während `package.json` Version 0.5.0 führt.
- **Hinweis:** Das ist nicht automatisch ein technischer Fehler. Eine Änderung des Release-Status muss bewusst mit Release-/Branding-Entscheidung erfolgen.

## Legacy-AirDeck-Konfiguration existiert aus Kompatibilitätsgründen
- **Bereich:** Migration / Docker
- **Status:** beabsichtigte Rückwärtskompatibilität.
- **Problem:** `docker-compose.yml` liest als Fallback weiterhin `AIRDECK_DB_PASSWORD`, damit bestehende Installationen ihr DB-Passwort behalten.
- **Nächster Schritt:** Nicht blind entfernen. Erst Migrations-/Kompatibilitätsstrategie prüfen. Keine neuen öffentlichen AirDeck-Bezeichnungen hinzufügen.

## Lokale Entwicklungsumgebung kann Node-Anforderung verfehlen
- **Bereich:** Development
- **Status:** Umgebungsrisiko.
- **Problem:** Das Projekt verlangt Node >= 22.18. Tests/Typecheck mit älterem Node sind kein verlässlicher Freigabenachweis.
- **Nächster Schritt:** Vor `npm run check` `node --version` prüfen und bei Abweichung Toolchain aktualisieren bzw. CI als Nachweis verwenden.

## Runtime-/Plattformfunktionen brauchen reale Prüfung
- **Bereich:** Audio / Streaming / Apps
- **Status:** Qualitätsanforderung.
- **Problem:** CI kann viele Pfade prüfen, ersetzt aber bei Audio, Live-Streaming, Mikrofon, Gerätefunktionen, Provider-Verbindungen und realem Plattformbetrieb nicht jede manuelle/live Verifikation.
- **Nächster Schritt:** Status nach `AI_HANDOVER.md` korrekt benennen und für Releases relevante manuelle Prüfungen dokumentieren.
