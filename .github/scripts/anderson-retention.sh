#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

BUILD_WORKFLOW_NAME="${ANDERSON_BUILD_WORKFLOW_NAME:-Build Anderson Home Firmware}"
CURRENT_RUN_ID="${GITHUB_RUN_ID:-0}"
CURRENT_WORKFLOW_NAME="${GITHUB_WORKFLOW:-}"
CLEAN_RELEASES="${CLEAN_RELEASES:-0}"

is_kept_run() {
  local id="$1" keep
  for keep in "${KEEP_RUN_IDS[@]:-}"; do
    [[ "$id" == "$keep" ]] && return 0
  done
  return 1
}

# Retain exactly two Anderson firmware-build generations. During the build that is
# still running, keep that current run plus the newest previously successful build.
KEEP_RUN_IDS=()
if [[ "$CURRENT_WORKFLOW_NAME" == "$BUILD_WORKFLOW_NAME" && "$CURRENT_RUN_ID" != "0" ]]; then
  KEEP_RUN_IDS+=("$CURRENT_RUN_ID")
  mapfile -t PREVIOUS_BUILD_RUNS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
      --jq ".workflow_runs[] | select(.id != $CURRENT_RUN_ID and .name == \"$BUILD_WORKFLOW_NAME\" and .status == \"completed\" and .conclusion == \"success\") | [.created_at,.id] | @tsv" \
      | sort -r | head -n 1 | cut -f2
  )
  KEEP_RUN_IDS+=("${PREVIOUS_BUILD_RUNS[@]:-}")
else
  mapfile -t LATEST_BUILD_RUNS < <(
    gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
      --jq ".workflow_runs[] | select(.name == \"$BUILD_WORKFLOW_NAME\" and .status == \"completed\" and .conclusion == \"success\") | [.created_at,.id] | @tsv" \
      | sort -r | head -n 2 | cut -f2
  )
  KEEP_RUN_IDS+=("${LATEST_BUILD_RUNS[@]:-}")
fi

# Remove every other completed Actions run. Deleting a run also removes its build
# artifacts, so the retained build runs are also the retained artifact generations.
mapfile -t COMPLETED_RUN_IDS < <(
  gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \
    --jq '.workflow_runs[] | select(.status == "completed") | .id'
)
for run_id in "${COMPLETED_RUN_IDS[@]:-}"; do
  [[ -n "$run_id" ]] || continue
  is_kept_run "$run_id" && continue
  gh api --method DELETE "/repos/$GITHUB_REPOSITORY/actions/runs/$run_id"
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
    gh api --method DELETE "/repos/$GITHUB_REPOSITORY/releases/$release_id"
  done
fi
