#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 /path/to/jason-home-release.jks /path/to/recovery-bundle [output-dir]"
  exit 2
fi

JKS="$1"
BUNDLE="$2"
OUT="${3:-./jason-home-restored-runtime}"
ALIAS="jason-home"
CERT="$BUNDLE/jason-home-backup-recipient.crt.pem"

if [ ! -f "$CERT" ]; then
  CERT="$(cd "$(dirname "$0")" && pwd)/jason-home-backup-recipient.crt.pem"
fi

for f in "$JKS" "$CERT" "$BUNDLE/oracle.env.cms" "$BUNDLE/jason-home.sqlite.cms"; do
  test -s "$f" || { echo "Missing required file: $f"; exit 1; }
done

read -r -s -p "Jason Home signing-keystore password: " PASS
echo
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

keytool -importkeystore   -srckeystore "$JKS" -srcstorepass "$PASS" -srcalias "$ALIAS"   -destkeystore "$TMP/recovery.p12" -deststoretype PKCS12   -deststorepass "$PASS" -destkeypass "$PASS" >/dev/null

openssl pkcs12 -in "$TMP/recovery.p12" -passin pass:"$PASS"   -nocerts -nodes -out "$TMP/private-key.pem" >/dev/null 2>&1

mkdir -p "$OUT"
openssl cms -decrypt -binary -inform DER   -in "$BUNDLE/oracle.env.cms" -recip "$CERT" -inkey "$TMP/private-key.pem"   -out "$OUT/.env"
openssl cms -decrypt -binary -inform DER   -in "$BUNDLE/jason-home.sqlite.cms" -recip "$CERT" -inkey "$TMP/private-key.pem"   -out "$OUT/jason-home.sqlite"
chmod 600 "$OUT/.env" "$OUT/jason-home.sqlite"

python3 - "$OUT/jason-home.sqlite" <<'PY'
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
result=db.execute("PRAGMA integrity_check").fetchone()[0]
db.close()
if result!="ok":
    raise SystemExit("Restored SQLite integrity check failed: "+str(result))
print("Restored SQLite integrity: ok")
PY

echo
echo "Recovered:"
echo "  $OUT/.env"
echo "  $OUT/jason-home.sqlite"
echo
echo "Copy .env to JasonHomeServer/.env and the database to JasonHomeServer/data/jason-home.sqlite."
