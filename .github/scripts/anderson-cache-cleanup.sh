#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN is required}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
gh cache list --repo "$repo" --limit 100 --json id,key,createdAt,lastAccessedAt > "$tmp"
python3 - "$tmp" <<'PY' | while read -r cache_id; do
import json,sys
rows=json.load(open(sys.argv[1],encoding='utf-8'))
prefixes=('Linux-anderson-objects-v1-','Linux-pio-v1-')
for prefix in prefixes:
    group=[r for r in rows if str(r.get('key','')).startswith(prefix)]
    group.sort(key=lambda r:(r.get('lastAccessedAt') or '',r.get('createdAt') or ''),reverse=True)
    for row in group[2:]: print(row['id'])
PY
  [ -z "$cache_id" ] || gh cache delete "$cache_id" --repo "$repo" || true
done
