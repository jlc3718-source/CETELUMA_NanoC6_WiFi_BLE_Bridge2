#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

MAX_AGE_HOURS="${BRANCH_MAX_AGE_HOURS:-2}"
CURRENT_BRANCH="${GITHUB_REF_NAME:-}"
NOW_EPOCH="$(date -u +%s)"
DELETED=0
KEPT=0

is_protected_branch() {
  case "$1" in
    main|ota|anderson-android-icon-release|anderson-play-icon-v1.0.1|build/silverado-aaos|codex/silverado-*|codex/anderson-android-v1) return 0 ;;
    *) return 1 ;;
  esac
}

is_anderson_work_branch() {
  case "$1" in
    automation/*|cleanup/*|cleanup-staging*|staging/*|publish/*|work/*|diag/*) return 0 ;;
    codex/v*|codex/anderson-*|codex/release-*|codex/full-code-audit-*|codex/daily-*|codex/lighting-test-*|codex/remove-*|codex/release-cleanup-*|codex/system-monitor-*|codex/white-calibration-*) return 0 ;;
    *) return 1 ;;
  esac
}

mapfile -t OPEN_PR_BRANCHES < <(
  gh api --paginate "/repos/$GITHUB_REPOSITORY/pulls?state=open&per_page=100" \
    --jq ".[] | select(.head.repo.full_name == \"$GITHUB_REPOSITORY\") | .head.ref" 2>/dev/null || true
)

has_open_pr() {
  local branch="$1" open
  for open in "${OPEN_PR_BRANCHES[@]:-}"; do
    [[ "$branch" == "$open" ]] && return 0
  done
  return 1
}

delete_ref() {
  local branch="$1"
  echo "Deleting stale Anderson work branch: $branch"
  gh api --method DELETE "/repos/$GITHUB_REPOSITORY/git/refs/heads/$branch"
  DELETED=$((DELETED+1))
}

mapfile -t BRANCHES < <(gh api --paginate "/repos/$GITHUB_REPOSITORY/branches?per_page=100" --jq '.[].name')
for branch in "${BRANCHES[@]:-}"; do
  [[ -n "$branch" ]] || continue
  is_protected_branch "$branch" && continue
  is_anderson_work_branch "$branch" || continue
  [[ "$branch" == "$CURRENT_BRANCH" ]] && continue
  has_open_pr "$branch" && { KEPT=$((KEPT+1)); continue; }

  sha="$(gh api "/repos/$GITHUB_REPOSITORY/branches/$branch" --jq '.commit.sha' 2>/dev/null || true)"
  [[ -n "$sha" ]] || continue
  committed="$(gh api "/repos/$GITHUB_REPOSITORY/commits/$sha" --jq '.commit.committer.date' 2>/dev/null || true)"
  [[ -n "$committed" ]] || continue
  commit_epoch="$(date -u -d "$committed" +%s)"
  age_hours=$(( (NOW_EPOCH - commit_epoch) / 3600 ))
  if (( age_hours >= MAX_AGE_HOURS )); then
    delete_ref "$branch"
  else
    echo "Keeping recent Anderson work branch (${age_hours}h < ${MAX_AGE_HOURS}h): $branch"
    KEPT=$((KEPT+1))
  fi
done

echo "Anderson branch cleanup complete: deleted=$DELETED kept_recent_or_open=$KEPT threshold=${MAX_AGE_HOURS}h"
