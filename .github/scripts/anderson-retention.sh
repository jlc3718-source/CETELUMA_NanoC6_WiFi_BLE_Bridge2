#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

BUILD_WORKFLOW_NAME="${ANDERSON_BUILD_WORKFLOW_NAME:-Build Anderson Home Firmware}"
LEGACY_BUILD_WORKFLOW_NAME="Run Wi-Fi Scan Fix v3.0.10"
CURRENT_RUN_ID="${GITHUB_RUN_ID:-0}"
CURRENT_WORKFLOW_NAME="${GITHUB_WORKFLOW:-}"
CLEAN_RELEASES="${CLEAN_RELEASES:-0}"
RUN_MAX_AGE_HOURS="${RUN_MAX_AGE_HOURS:-48}"
RUN_KEEP_LATEST="${RUN_KEEP_LATEST:-20}"
NOW_EPOCH="$(date -u +%s)"
CUTOFF_EPOCH=$((NOW_EPOCH-RUN_MAX_AGE_HOURS*3600))

is_kept_run() {
  local id="$1" keep
  [[ "$id" == "$CURRENT_RUN_ID" ]] && return 0
  for keep in "${KEEP_RUN_IDS[@]:-}"; do
    [[ "$id" == "$keep" ]] && return 0
  done
  return 1
}

# Preserve the current and immediately previous successful Anderson firmware
# build generations as the proof/recovery chain.
KEEP_RUN_IDS=()
if [[ "$CURRENT_WORKFLOW_NAME" == "$BUILD_WORKFLOW_NAME" && "$CURRENT_RUN_ID" != "0" ]]; then
  KEEP_RUN_IDS+=("$CURRENT_RUN_ID")
  mapfile -t PREVIOUS_BUILD_RUNS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
      --jq ".workflow_runs[] | select(.id != $CURRENT_RUN_ID and (.name == \"$BUILD_WORKFLOW_NAME\" or .name == \"$LEGACY_BUILD_WORKFLOW_NAME\") and .status == \"completed\" and .conclusion == \"success\") | [.created_at,.id] | @tsv" \
      | sort -r | head -n 1 | cut -f2
  )
  KEEP_RUN_IDS+=("${PREVIOUS_BUILD_RUNS[@]:-}")
else
  mapfile -t LATEST_BUILD_RUNS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
      --jq ".workflow_runs[] | select((.name == \"$BUILD_WORKFLOW_NAME\" or .name == \"$LEGACY_BUILD_WORKFLOW_NAME\") and .status == \"completed\" and .conclusion == \"success\") | [.created_at,.id] | @tsv" \
      | sort -r | head -n 2 | cut -f2
  )
  KEEP_RUN_IDS+=("${LATEST_BUILD_RUNS[@]:-}")
fi

# Hard-cap repository workflow history by preserving the newest N runs across
# all workflows. The currently executing cleanup run is naturally among these
# newest runs and is also explicitly protected above.
if ((RUN_KEEP_LATEST>0)); then
  mapfile -t LATEST_RUN_IDS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
      --jq '.workflow_runs[] | [.created_at,.id] | @tsv' \
      | sort -r | head -n "$RUN_KEEP_LATEST" | cut -f2
  )
  KEEP_RUN_IDS+=("${LATEST_RUN_IDS[@]:-}")
fi

# Delete completed runs outside the retained newest-run set. If the hard cap is
# disabled (RUN_KEEP_LATEST=0), fall back to the age-based retention window.
mapfile -t COMPLETED_RUN_ROWS < <(
  gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
    --jq '.workflow_runs[] | select(.status == "completed") | [.id,.updated_at] | @tsv'
)
for row in "${COMPLETED_RUN_ROWS[@]:-}"; do
  [[ -n "$row" ]] || continue
  run_id="${row%%$'\t'*}"
  updated="${row#*$'\t'}"
  is_kept_run "$run_id" && continue

  if ((RUN_KEEP_LATEST>0)); then
    gh api --method DELETE "/repos/$GITHUB_REPOSITORY/actions/runs/$run_id" || true
    continue
  fi

  updated_epoch="$(date -u -d "$updated" +%s 2>/dev/null || echo "$NOW_EPOCH")"
  if ((updated_epoch<=CUTOFF_EPOCH)); then
    gh api --method DELETE "/repos/$GITHUB_REPOSITORY/actions/runs/$run_id" || true
  fi
done

if [[ "$CLEAN_RELEASES" == "1" ]]; then
  # Keep the newest two stable Anderson releases (current + one previous backup).
  # Deleting a release removes its BIN/release.json assets but intentionally leaves
  # the Git tag/source history intact.
  mapfile -t OLD_RELEASE_IDS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/releases?per_page=100" \
      --jq '.[] | select(.draft == false and .prerelease == false and (.tag_name | startswith("anderson-v"))) | [.published_at,.id] | @tsv' \
      | sort -r | tail -n +3 | cut -f2
  )
  for release_id in "${OLD_RELEASE_IDS[@]:-}"; do
    [[ -n "$release_id" ]] || continue
    gh api --method DELETE "/repos/$GITHUB_REPOSITORY/releases/$release_id" || true
  done
fi
