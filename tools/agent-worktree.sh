#!/usr/bin/env bash
# A working directory of your own, off this repository.
#
#   tools/agent-worktree.sh <your-agent-name>
#
# WHY THIS EXISTS. Two agents shared one checkout on 2026-09-15 and lost work
# into each other's commits twice in four hours — in both directions, after
# agreeing a rule to prevent it, while both were being careful:
#
#   - 047edb2, a commit about a stale URL, carries four of Sill's unfinished
#     files including a server route.
#   - 3debe5c, a commit about sleeping agents, carries all six of Plumbline's
#     retired-actor files.
#
# The second one is the instructive one. Plumbline had staged their files BY
# NAME, exactly as agreed. A checkout has ONE INDEX, and `git commit` commits
# the whole of it — so careful staging by one agent is what put its work inside
# the other's commit. No amount of care fixes that; a separate index does.
#
# And the deploy script ships the WORKING TREE, so a deploy by one agent
# published whatever the other had half-written, under a commit that did not
# contain it.
#
# WHAT YOU GET: your own directory, your own index, your own dirty state, and
# your own branch. `git add -A` can only ever reach your own files.
#
# WHAT IT COSTS: one extra step to ship, because git refuses to check out the
# same branch in two places. You merge your branch into main in the release
# tree and deploy from there. See docs/AGENT-BRIEF.md.
set -euo pipefail

NAME="${1:-}"
[ -n "$NAME" ] || { echo "usage: tools/agent-worktree.sh <your-agent-name>" >&2; exit 2; }
case "$NAME" in
  *[!a-z0-9-]*) echo "use lower-case letters, digits and hyphens: $NAME" >&2; exit 2 ;;
esac

RELEASE="$(git rev-parse --show-toplevel)"
# Beside the release tree rather than inside it: a worktree inside the repo
# would be swept into the deploy's rsync and shipped to the server.
TREE="$(dirname "$RELEASE")/$(basename "$RELEASE" | sed 's/-qa$//')-$NAME"

if [ -d "$TREE" ]; then
  echo "already there: $TREE"
else
  git -C "$RELEASE" worktree add "$TREE" -b "$NAME"
fi

cd "$TREE"
# Hard-linked from the pnpm store, so this is seconds and almost no disk.
pnpm install --frozen-lockfile
# A FRESH TREE MUST BE BUILT ONCE, or 133 server tests fail: `buildServer`
# refuses to start without a built UI, which is deliberate — a server that
# boots while serving nothing looks healthy and is useless. Discovered by
# running the suite in the first of these worktrees and reading the failures.
pnpm run build

cat <<NOTES

  Your tree:   $TREE
  Your branch: $NAME
  The release tree stays on main and stays clean: $RELEASE

  Work here. To ship, from this tree:

    git commit -m "…" -- path/one.ts path/two.ts      # a pathspec, not add + commit
    git -C "$RELEASE" merge --ff-only $NAME
    (cd "$RELEASE" && PUBLIC_URL=https://saha.ing deploy/release.sh root@saha.ing)
    git -C "$RELEASE" push origin main

  If the merge refuses, main has moved: rebase your branch on it first
  (git fetch && git rebase origin/main) and try again. Never rewrite a branch
  somebody else has pulled.
NOTES
