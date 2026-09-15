#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN is required}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
max_age_hours="${CACHE_MAX_AGE_HOURS:-48}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Pull the complete cache inventory. The permanent build currently uses the
# pio-v2 scoped dependency cache and anderson-objects-v2 object cache; Python/npm setup
# actions also create reusable caches. Keep the newest cache in each active
# family so a quiet repository does not force a totally cold build, while stale
# duplicates age out after the configured retention window.
gh cache list --repo "$repo" --limit 10000 --json id,key,createdAt,lastAccessedAt > "$tmp"
python3 - "$tmp" "$max_age_hours" <<'PY' | while read -r cache_id; do
from datetime import datetime, timezone, timedelta
import json,sys
rows=json.load(open(sys.argv[1],encoding='utf-8'))
max_age=timedelta(hours=int(sys.argv[2]))
now=datetime.now(timezone.utc)
active_prefixes=(
    'Linux-pio-v2-',
    'Linux-anderson-objects-v2-',
    'setup-python-',
    'node-cache-',
)

def stamp(row):
    raw=row.get('lastAccessedAt') or row.get('createdAt') or '1970-01-01T00:00:00Z'
    return datetime.fromisoformat(raw.replace('Z','+00:00'))

newest_by_family={}
for prefix in active_prefixes:
    matches=[r for r in rows if str(r.get('key','')).startswith(prefix)]
    if matches:
        newest_by_family[prefix]=max(matches,key=stamp).get('id')

for row in rows:
    cid=row.get('id')
    if not cid:
        continue
    # Preserve exactly one warm cache for each active family even when idle.
    if any(newest_by_family.get(prefix)==cid for prefix in active_prefixes):
        continue
    if now-stamp(row) >= max_age:
        print(cid)
PY
  [ -z "$cache_id" ] || gh cache delete "$cache_id" --repo "$repo" || true
done
