#!/usr/bin/env bash
set -euo pipefail

repo="ideav/crm"
remote="origin"
base_branch="main"
days_old=0
execute=0
include_closed=0
branch_prefix_regex='^(issue-|fix[-/]|feature/|revert-)'

usage() {
  cat <<'USAGE'
Delete remote branches whose latest GitHub pull request is already merged.

Dry-run is the default. Pass --execute to actually delete branches.

Usage:
  tools/delete-merged-pr-branches.sh [options]

Options:
  --repo OWNER/REPO          GitHub repository (default: ideav/crm)
  --remote NAME              Git remote name (default: origin)
  --base BRANCH              Protected base branch to keep (default: main)
  --days-old N               Only delete branches whose merged PR is at least N days old
  --prefix-regex REGEX       Only consider branch names matching REGEX
                             (default: ^(issue-|fix[-/]|feature/|revert-))
  --include-closed           Also delete branches whose latest PR is closed but not merged
  --execute                  Delete branches; without this only prints what would happen
  -h, --help                 Show this help

Requirements:
  gh, git, date

Examples:
  tools/delete-merged-pr-branches.sh
  tools/delete-merged-pr-branches.sh --days-old 14
  tools/delete-merged-pr-branches.sh --execute --days-old 7
USAGE
}

log() {
  printf '%s\n' "$*" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)
        repo="${2:?--repo requires OWNER/REPO}"
        shift 2
        ;;
      --remote)
        remote="${2:?--remote requires a remote name}"
        shift 2
        ;;
      --base)
        base_branch="${2:?--base requires a branch name}"
        shift 2
        ;;
      --days-old)
        days_old="${2:?--days-old requires a number}"
        shift 2
        ;;
      --prefix-regex)
        branch_prefix_regex="${2:?--prefix-regex requires a regex}"
        shift 2
        ;;
      --include-closed)
        include_closed=1
        shift
        ;;
      --execute)
        execute=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

validate_args() {
  if ! [[ "$days_old" =~ ^[0-9]+$ ]]; then
    log "--days-old must be a non-negative integer"
    exit 1
  fi
}

date_epoch() {
  local value="$1"

  if date -u -d "$value" +%s >/dev/null 2>&1; then
    date -u -d "$value" +%s
    return
  fi

  date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$value" +%s
}

days_ago_epoch() {
  local days="$1"

  if date -u -d "$days days ago" +%s >/dev/null 2>&1; then
    date -u -d "$days days ago" +%s
    return
  fi

  date -u -v-"${days}"d +%s
}

branch_is_protected() {
  local branch="$1"

  [[ "$branch" == "$base_branch" ]] && return 0
  [[ "$branch" == "HEAD" ]] && return 0
  [[ "$branch" == "master" ]] && return 0
  [[ "$branch" == "main" ]] && return 0

  return 1
}

branch_matches_scope() {
  local branch="$1"

  [[ "$branch" =~ $branch_prefix_regex ]]
}

pr_allows_delete() {
  local branch="$1"
  local pr_fields pr_number state merged_at pr_url cutoff_epoch merged_epoch

  pr_fields="$(gh pr list \
    --repo "$repo" \
    --head "$branch" \
    --state all \
    --limit 1 \
    --json number,state,mergedAt,url \
    --jq '.[0] | select(.) | [.number, .state, ((.mergedAt // "") | if . == "" then "-" else . end), .url] | @tsv')"

  if [[ -z "$pr_fields" ]]; then
    log "SKIP $branch: no pull request found"
    return 1
  fi

  IFS=$'\t' read -r pr_number state merged_at pr_url <<<"$pr_fields"
  [[ "$merged_at" == "-" ]] && merged_at=""

  if [[ -n "$merged_at" ]]; then
    if (( days_old > 0 )); then
      cutoff_epoch="$(days_ago_epoch "$days_old")"
      merged_epoch="$(date_epoch "$merged_at")"

      if (( merged_epoch > cutoff_epoch )); then
        log "SKIP $branch: merged at $merged_at, newer than ${days_old}d"
        return 1
      fi
    fi

    printf '%s\t%s\t%s\t%s\n' "$pr_number" "$state" "$merged_at" "$pr_url"
    return 0
  fi

  if (( include_closed == 1 )) && [[ "$state" == "CLOSED" ]]; then
    printf '%s\t%s\t%s\t%s\n' "$pr_number" "$state" "$merged_at" "$pr_url"
    return 0
  fi

  log "SKIP $branch: latest PR is $state and not merged"
  return 1
}

delete_branch() {
  local branch="$1"

  if (( execute == 1 )); then
    git push "$remote" --delete "$branch"
  else
    printf 'DRY-RUN git push %q --delete %q\n' "$remote" "$branch"
  fi
}

main() {
  parse_args "$@"
  validate_args

  require_command gh
  require_command git
  require_command date

  log "Fetching and pruning $remote..."
  git fetch --prune "$remote"

  local deleted_count=0
  local branch pr_fields pr_number pr_state pr_merged_at pr_url

  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue

    if branch_is_protected "$branch"; then
      log "SKIP $branch: protected branch"
      continue
    fi

    if ! branch_matches_scope "$branch"; then
      log "SKIP $branch: does not match --prefix-regex"
      continue
    fi

    if pr_fields="$(pr_allows_delete "$branch")"; then
      IFS=$'\t' read -r pr_number pr_state pr_merged_at pr_url <<<"$pr_fields"
      log "DELETE $branch: PR #$pr_number $pr_url"
      delete_branch "$branch"
      deleted_count=$((deleted_count + 1))
    fi
  done < <(git branch -r --format='%(refname:short)' --merged "$remote/$base_branch" |
    sed "s#^${remote}/##" |
    sort -u)

  if (( execute == 1 )); then
    log "Deleted $deleted_count branch(es)."
  else
    log "Dry-run complete. $deleted_count branch(es) would be deleted. Pass --execute to apply."
  fi
}

main "$@"
