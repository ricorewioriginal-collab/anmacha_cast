#!/usr/bin/env bash
# Erzeugt den Signaturschluessel fuer die AnMaCha-Cast-Android-App und kann die 4 GitHub-Secrets selbst setzen.
#
# Aufruf:   bash scripts/create-android-keystore.sh [--set-secrets]
#
# - Schluessel und zufaellige Passwoerter entstehen NUR lokal in  ~/anmachacast-signing/
# - Mit --set-secrets (und angemeldetem GitHub-CLI "gh": einmal "gh auth login") werden die Secrets direkt im
#   Repository gesetzt; die Werte erscheinen dabei nicht auf dem Bildschirm.
# - Ohne --set-secrets stehen die vier Werte in Textdateien zum Einfuegen in GitHub.
#
# Den Ordner SICHER sichern (Passwortmanager + Offline-Kopie), niemals ins Git legen und niemandem schicken.
# Ohne den Schluessel lassen sich bereits installierte Apps nicht mehr aktualisieren.
set -euo pipefail

REPO="ricorewioriginal-collab/anmacha_cast"
OUT_DIR="${SIGNING_DIR:-$HOME/anmachacast-signing}"
KEYSTORE="$OUT_DIR/anmachacast.jks"
ALIAS="anmachacast"
SET_SECRETS=0
[[ "${1:-}" == "--set-secrets" ]] && SET_SECRETS=1

for tool in keytool openssl base64; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool fehlt (JDK 17+ bzw. openssl installieren, in Termux: pkg install openjdk-17 openssl-tool)." >&2; exit 1; }
done

if [[ -e "$KEYSTORE" ]]; then
  echo "Es gibt schon einen Schluessel: $KEYSTORE" >&2
  echo "Er wird NICHT ueberschrieben. Fuer einen neuen den alten bewusst selbst verschieben." >&2
  exit 1
fi

umask 077
mkdir -p "$OUT_DIR"

STORE_PASS="$(openssl rand -hex 16)"
KEY_PASS="$STORE_PASS"   # PKCS12: Keystore- und Schluesselpasswort sind identisch

keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "CN=AnMaCha Cast, OU=Development, O=RicoReWi, C=DE" >/dev/null 2>&1

printf '%s' "$(base64 < "$KEYSTORE" | tr -d '\n')" > "$OUT_DIR/ANDROID_KEYSTORE_B64.txt"
printf '%s' "$STORE_PASS" > "$OUT_DIR/ANDROID_KEYSTORE_PASSWORD.txt"
printf '%s' "$ALIAS"      > "$OUT_DIR/ANDROID_KEY_ALIAS.txt"
printf '%s' "$KEY_PASS"   > "$OUT_DIR/ANDROID_KEY_PASSWORD.txt"

FPR="$(keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$STORE_PASS" 2>/dev/null | awk -F': ' '/SHA256:/{print $2; exit}')"
echo
echo "Schluessel erzeugt:  $KEYSTORE"
echo "Zertifikat SHA-256:  $FPR"
echo

NAMES="ANDROID_KEYSTORE_B64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD"
if [[ $SET_SECRETS -eq 1 ]]; then
  command -v gh >/dev/null 2>&1 || { echo "--set-secrets braucht das GitHub-CLI 'gh' (angemeldet mit 'gh auth login')." >&2; exit 1; }
  for name in $NAMES; do
    gh secret set "$name" --repo "$REPO" < "$OUT_DIR/$name.txt"
    echo "Secret gesetzt: $name"
  done
  echo "Fertig. Der naechste Build auf main bzw. mit Versions-Tag signiert die APK mit diesem Schluessel."
else
  echo "Lege in GitHub ($REPO -> Settings -> Secrets and variables -> Actions) diese Secrets an;"
  echo "jeder Wert steht in einer gleichnamigen .txt-Datei in $OUT_DIR :"
  for name in $NAMES; do echo "  $name"; done
fi
echo
echo "WICHTIG: Ordner $OUT_DIR sichern (Passwortmanager/Offline-Kopie). Die .txt-Dateien erst loeschen, wenn die"
echo "Secrets gesetzt sind. Schluessel und Passwoerter niemals weitergeben, auch nicht in einen Chat."
