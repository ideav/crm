#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
script="$repo_root/tools/delete-merged-pr-branches.sh"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/bin"

cat >"$tmp_dir/bin/git" <<'GIT'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2 $3" == "fetch --prune origin" ]]; then
  exit 0
fi

if [[ "$1 $2" == "branch -r" ]]; then
  cat <<'BRANCHES'
origin/HEAD
origin/main
origin/issue-123-old
origin/issue-124-open
origin/feature/old-merged
origin/random-old
BRANCHES
  exit 0
fi

if [[ "$1 $2 $3" == "push origin --delete" ]]; then
  echo "DELETED $4"
  exit 0
fi

echo "unexpected git args: $*" >&2
exit 1
GIT

cat >"$tmp_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail

branch=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --head)
      branch="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

case "$branch" in
  issue-123-old)
    printf '123\tMERGED\t2026-01-01T00:00:00Z\thttps://github.com/ideav/crm/pull/123\n'
    ;;
  feature/old-merged)
    printf '125\tMERGED\t2026-01-02T00:00:00Z\thttps://github.com/ideav/crm/pull/125\n'
    ;;
  issue-124-open)
    printf '124\tOPEN\t-\thttps://github.com/ideav/crm/pull/124\n'
    ;;
esac
GH

chmod +x "$tmp_dir/bin/git" "$tmp_dir/bin/gh"

output="$(PATH="$tmp_dir/bin:$PATH" "$script" 2>&1)"

grep -F 'DRY-RUN git push origin --delete issue-123-old' <<<"$output"
grep -F 'DRY-RUN git push origin --delete feature/old-merged' <<<"$output"
grep -F 'SKIP issue-124-open: latest PR is OPEN and not merged' <<<"$output"
grep -F 'SKIP random-old: does not match --prefix-regex' <<<"$output"
grep -F 'Dry-run complete. 2 branch(es) would be deleted.' <<<"$output"

execute_output="$(PATH="$tmp_dir/bin:$PATH" "$script" --execute 2>&1)"

grep -F 'DELETED issue-123-old' <<<"$execute_output"
grep -F 'DELETED feature/old-merged' <<<"$execute_output"
grep -F 'Deleted 2 branch(es).' <<<"$execute_output"

echo "delete-merged-pr-branches tests passed"
