# Branch Maintenance

This repository keeps many short-lived `issue-*`, `fix-*`, `feature/*`, and
`revert-*` branches after their pull requests are merged. They do not change
the contents of `main`, but they make branch lists, autocomplete, and manual
GitHub navigation noisy.

## Do Stale Branches Block Work?

No. Stale remote branches usually do not affect builds, deployments, or the
current working branch. They mainly interfere with developer workflow:

- long `git branch -a` output;
- slower manual search in branch selectors;
- higher risk of selecting an obsolete branch by mistake;
- harder review of which work is still active.

## When To Delete Branches

Delete a branch when all of these are true:

- its pull request is merged or closed;
- the branch is not the default branch;
- nobody is actively using it for follow-up work;
- there is no open pull request targeting it.

Keep branches that are still tied to open pull requests, active experiments, or
release work.

## Safe Cleanup Commands

Use the checked-in script for reviewed cleanup. It is dry-run by default and
only considers remote branches whose latest GitHub pull request is merged:

```bash
tools/delete-merged-pr-branches.sh
```

Delete only branches whose merged pull request is at least 14 days old:

```bash
tools/delete-merged-pr-branches.sh --days-old 14 --execute
```

The script keeps `main`, `master`, `HEAD`, and the configured base branch. By
default it only considers `issue-*`, `fix-*`, `fix/*`, `feature/*`, and `revert-*`
branches. Use `--help` to see all options.

List merged remote branches:

```bash
git fetch --prune origin
git branch -r --merged origin/main
```

Delete one obsolete remote branch:

```bash
git push origin --delete branch-name
```

Prune local references after remote cleanup:

```bash
git fetch --prune origin
```

Prefer deleting branches one by one or in small reviewed batches. Do not delete
branches only because they are old; confirm the corresponding pull request state
first.
