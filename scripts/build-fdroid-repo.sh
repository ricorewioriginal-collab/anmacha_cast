#!/usr/bin/env bash
# Baut aus der signierten Android-APK ein eigenes F-Droid-Repository (statische Dateien für GitHub Pages).
#
# Aufruf:  scripts/build-fdroid-repo.sh <apk> <ausgabeordner>
# Umgebung (wie im Android-Build): ANDROID_KEYSTORE (Pfad), ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
# ANDROID_KEY_PASSWORD. Optional: FDROID_BASE_URL (Standard: die Projektseite auf GitHub Pages).
# Voraussetzung: fdroidserver (pip install fdroidserver) und das Android SDK (ANDROID_HOME, apksigner).
# Der Index wird mit demselben Schlüssel signiert wie die App; sein Fingerabdruck steht in <ausgabeordner>/index.html.
set -euo pipefail

APK="${1:?APK-Datei fehlt}"
OUT="${2:?Ausgabeordner fehlt}"
BASE="${FDROID_BASE_URL:-https://ricorewioriginal-collab.github.io/anmacha_cast/fdroid}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="app.anmachacast.studio"
: "${ANDROID_KEYSTORE:?}" "${ANDROID_KEYSTORE_PASSWORD:?}" "${ANDROID_KEY_ALIAS:?}" "${ANDROID_KEY_PASSWORD:?}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/repo" "$WORK/metadata"
cp "$APK" "$WORK/repo/${APP_ID}.apk"
cp "$HERE/packaging/fdroid/$APP_ID.yml" "$WORK/metadata/$APP_ID.yml"
mkdir -p "$WORK/repo/icons"
cp "$HERE/studio/icons/icon-512.png" "$WORK/repo/icons/icon.png"

umask 077
cat > "$WORK/config.yml" <<CFG
repo_url: $BASE/repo
repo_name: AnMaCha Cast
repo_description: Offizielles F-Droid-Repository von AnMaCha Cast (Radio-Automation, Handy-Sender, Studio-Fernbedienung).
repo_icon: icon.png
archive_older: 0
keystore: $ANDROID_KEYSTORE
repo_keyalias: $ANDROID_KEY_ALIAS
keystorepass: $ANDROID_KEYSTORE_PASSWORD
keypass: $ANDROID_KEY_PASSWORD
keydname: CN=AnMaCha Cast, OU=Development, O=RicoReWi, C=DE
CFG
chmod 600 "$WORK/config.yml"
(cd "$WORK" && fdroid update)
(cd "$WORK" && fdroid signindex)

FPR="$(keytool -list -v -keystore "$ANDROID_KEYSTORE" -alias "$ANDROID_KEY_ALIAS" -storepass "$ANDROID_KEYSTORE_PASSWORD" 2>/dev/null \
  | awk -F': ' '/SHA256:/{print $2; exit}' | tr -d ':' | tr 'A-F' 'a-f')"
[ -n "$FPR" ] || { echo "Fingerabdruck nicht lesbar" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$WORK/repo" "$OUT/repo"
LINK="$BASE/repo?fingerprint=$FPR"
cat > "$OUT/index.html" <<HTML
<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AnMaCha Cast – F-Droid</title>
<style>:root{color-scheme:dark}body{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;background:#030914;color:#f5f9ff;line-height:1.6}main{max-width:720px;margin:auto;padding:32px 18px}a{color:#18b7ff}code{display:block;word-break:break-all;background:#061426;border:1px solid #16466e;border-radius:10px;padding:10px 12px;margin:6px 0 16px}.btn{display:inline-block;padding:13px 18px;border-radius:14px;background:#18b7ff;color:#00101c;font-weight:700;text-decoration:none}</style></head><body><main>
<h1>AnMaCha Cast in F-Droid</h1>
<p>Eigenes F-Droid-Repository des Projekts: Die Android-App lässt sich damit über F-Droid (oder Droid-ify, Neo Store) installieren und automatisch aktualisieren. Es ist nicht der offizielle F-Droid-Katalog.</p>
<p><a class="btn" href="$LINK">In F-Droid hinzufügen</a></p>
<p>Oder in der F-Droid-App unter <em>Einstellungen → Paketquellen → Hinzufügen</em> eintragen:</p>
<strong>Adresse</strong><code>$BASE/repo</code>
<strong>Fingerabdruck (SHA-256)</strong><code>$FPR</code>
<p>Die App ist mit demselben Schlüssel signiert wie die APK in den <a href="https://github.com/ricorewioriginal-collab/anmacha_cast/releases/latest">GitHub-Releases</a>; beide Wege lassen sich gegenseitig aktualisieren.</p>
<p><a href="../">← Zur Projektseite</a></p></main></body></html>
HTML
echo "F-Droid-Repository: $OUT (Fingerabdruck $FPR)"
