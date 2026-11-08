#!/usr/bin/env bash
# Run ON the owner's Oracle server only. Keeps private data local until deliberately copied.
set -euo pipefail
umask 077
PUBLIC_KEY="${1:?Usage: ./ORACLE-PRIVATE-SNAPSHOT.sh /path/to/Oracle-Backup-Public-Key.pem}"
test -s "$PUBLIC_KEY"
ROOT=/home/ubuntu/repo/JasonHomeServer
GATE=/opt/jason-home-2
# Commands requiring privilege use individually authorized noninteractive sudo.
test -s "$ROOT/.env" && test -s "$ROOT/data/jason-home.sqlite" && sudo test -s "$GATE/private.env"
WORK="$(mktemp -d)"
trap 'sudo rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stage/controller" "$WORK/stage/gateway" "$WORK/stage/system" "$WORK/stage/info"
# Online SQLite backup avoids copying a live WAL database in a torn/inconsistent state.
sudo python3 - "$ROOT" "$GATE" "$WORK/stage" <<'PY'
import os,sqlite3,sys
root,gate,stage=sys.argv[1:]
for prefix,dir in [('controller',os.path.join(root,'data')),('gateway',os.path.join(gate,'data'))]:
    if not os.path.isdir(dir):continue
    for top,dirs,files in os.walk(dir):
        for f in files:
            if not f.endswith(('.sqlite','.sqlite3','.db')):continue
            src=os.path.join(top,f)
            rel=os.path.relpath(src,dir)
            target=os.path.join(stage,prefix,'db',rel)
            os.makedirs(os.path.dirname(target),exist_ok=True)
            rd=sqlite3.connect('file:'+src+'?mode=ro',uri=True)
            wr=sqlite3.connect(target)
            with wr:rd.backup(wr)
            assert wr.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            wr.close();rd.close()
PY
sudo cp -a "$ROOT/.env" "$WORK/stage/controller/.env"
# Capture current editable application source, excluding runtime databases and dependency caches.
sudo tar -C "$ROOT" -czf "$WORK/stage/controller/controller-source.tar.gz" \
  --exclude='./data' --exclude='./node_modules' --exclude='./.git' --exclude='./.env' \
  --exclude='*.log' --exclude='./.cache' .
# Copy changing non-database runtime files into a stable temporary tree first.
# The live system keeps writing logs/cache while an archive is built.
sudo python3 - "$ROOT/data" "$GATE/data" "$WORK/stage" <<'PY'
import os,shutil,sys
controller,gateway,stage=sys.argv[1:]
for name,src in [('controller',controller),('gateway',gateway)]:
    dest=os.path.join(stage,name,'data-other')
    os.makedirs(dest,exist_ok=True)
    if not os.path.isdir(src):continue
    for root,dirs,files in os.walk(src):
        dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(root,d))]
        rel=os.path.relpath(root,src)
        out=os.path.join(dest,rel)
        os.makedirs(out,exist_ok=True)
        for filename in files:
            if filename.endswith(('.sqlite','.sqlite3','.db','.sqlite-wal','.sqlite-shm','.db-wal','.db-shm')):continue
            source=os.path.join(root,filename)
            if os.path.islink(source):continue
            try:shutil.copy2(source,os.path.join(out,filename))
            except (FileNotFoundError,PermissionError):continue
PY
sudo tar -C "$WORK/stage/controller" -czf "$WORK/stage/controller/controller-data-other.tar.gz" data-other
sudo tar -C "$WORK/stage/gateway" -czf "$WORK/stage/gateway/gateway-data-other.tar.gz" data-other
sudo rm -rf "$WORK/stage/controller/data-other" "$WORK/stage/gateway/data-other"
sudo cp -a "$GATE/private.env" "$WORK/stage/gateway/private.env"
sudo cp -a /etc/nginx "$WORK/stage/system/nginx"
if sudo test -d /etc/letsencrypt; then sudo cp -a /etc/letsencrypt "$WORK/stage/system/letsencrypt"; fi
if sudo test -d /home/ubuntu/.jason-home-signing; then sudo cp -a /home/ubuntu/.jason-home-signing "$WORK/stage/system/signing"; fi
sudo docker ps --format '{{json .}}' > "$WORK/stage/info/docker-ps.jsonl"
sudo docker inspect jason-home-2-web > "$WORK/stage/info/jh2-web-container.json"
curl -fsS http://127.0.0.1:8080/api/health > "$WORK/stage/info/controller-health.json"
curl -fsS http://127.0.0.1:8081/api/health > "$WORK/stage/info/web-health.json"
git -C /home/ubuntu/repo rev-parse HEAD > "$WORK/stage/info/production-git-sha.txt"
sudo chown -R "$(id -u):$(id -g)" "$WORK/stage"
OUT="${JH2_SNAPSHOT_OUT:-/home/ubuntu/jh2-private-snapshot}"
mkdir -p "$OUT"
test ! -e "$OUT/oracle-recovery.tar.gz.aes" || { echo 'Snapshot already exists; refusing overwrite'; exit 1; }
tar -C "$WORK/stage" -czf "$WORK/private.tar.gz" .
tar -tzf "$WORK/private.tar.gz" >/dev/null
PASS="$(openssl rand -hex 32)"
printf '%s' "$PASS" | openssl pkeyutl -encrypt -pubin -inkey "$PUBLIC_KEY" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -out "$OUT/password.rsa-oaep-sha256.enc"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 -in "$WORK/private.tar.gz" -out "$OUT/oracle-recovery.tar.gz.aes" -pass "pass:$PASS"
BASE="$(sha256sum "$WORK/private.tar.gz" | cut -d' ' -f1)"
CHECK="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in "$OUT/oracle-recovery.tar.gz.aes" -pass "pass:$PASS" | sha256sum | cut -d' ' -f1)"
test "$BASE" = "$CHECK"
(cd "$OUT"; sha256sum *.aes *.enc > SHA256SUMS.txt)
echo "Encrypted Oracle backup verified. Copy the three encrypted/checksum files from $OUT to private Google Drive; do NOT copy unencrypted data."
