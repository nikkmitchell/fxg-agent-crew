#!/usr/bin/env bash
# Refuse to ship a tree that does not contain what is already live.
#
# release.sh sends the WHOLE working tree. On 2026-09-19 two agents deploying
# from two worktrees noticed that nothing stopped either of them shipping a
# branch that lacked the other's live commits. That rolls them back quietly:
# the deploy succeeds, every check after it passes, and somebody's fix is gone
# from the site with nothing to say so. Whether the live commit is an ancestor
# of HEAD is a question git answers exactly, so it is asked here instead of
# relying on everybody remembering to merge first.
#
#   . deploy/live-guard.sh
#   contains_live <live commit, or empty if the box has none> <rollback: 0|1>
#
# Prints what it decided. Returns non-zero, with the reason on stderr, to refuse.
# Tested by deploy/live-guard.test.sh against a scratch repository.

contains_live() {
  local live="$1" rollback="${2:-0}" head
  head="$(git rev-parse HEAD)"

  # NO RECORD IS "CANNOT TELL", NOT "NOTHING LIVE". A box restored from a
  # backup, a marker removed by hand, or a deploy that died before writing it
  # all look like this, and each is running something. This read "nothing to
  # roll back" and shipped until Nightjar pointed out that the unknown-commit
  # branch below says the opposite. A brand-new box is the one honest case, and
  # it takes --rollback like every other deliberate override.
  if [ -z "$live" ]; then
    if [ "$rollback" = "1" ]; then
      printf '\033[33m  live         the box records no deployed commit; shipping anyway because you asked (--rollback)\033[0m\n'
      return 0
    fi
    printf 'the box records no deployed commit, so this cannot tell what shipping HEAD %s would replace.\n' "$head" >&2
    printf '  On a brand-new box that is expected: re-run with --rollback.\n' >&2
    printf '  Otherwise find out why DEPLOYED_COMMIT is missing before shipping over whatever is running.\n' >&2
    return 1
  fi

  # A commit this checkout has never seen cannot be checked either way, and
  # "cannot tell" must not read as "fine".
  if ! git cat-file -e "${live}^{commit}" 2>/dev/null; then
    if [ "$rollback" = "1" ]; then
      printf '\033[33m  live         %s is unknown to this checkout; replacing it because you asked (--rollback)\033[0m\n' "${live:0:8}"
      return 0
    fi
    printf 'the box is running %s, which this checkout has never seen, so it cannot tell whether HEAD %s contains it.\n' "$live" "$head" >&2
    printf '  Fetch or merge whatever was deployed (git fetch, then git merge %s) and deploy again.\n' "${live:0:12}" >&2
    printf '  To replace it on purpose, re-run with --rollback.\n' >&2
    return 1
  fi

  if git merge-base --is-ancestor "$live" "$head"; then
    if [ "$(git rev-parse "${live}^{commit}")" = "$head" ]; then
      printf '  live         %s is HEAD, so this redeploys the same commit\n' "${live:0:8}"
    else
      printf '  live         %s is contained in HEAD %s, %s commit(s) behind it\n' \
        "${live:0:8}" "${head:0:8}" "$(git rev-list --count "${live}..${head}")"
    fi
    return 0
  fi

  if [ "$rollback" = "1" ]; then
    printf '\033[33m  live         %s is NOT in HEAD %s; rolling it back because you asked (--rollback)\033[0m\n' \
      "${live:0:8}" "${head:0:8}"
    return 0
  fi
  printf 'HEAD %s does not contain the live commit %s.\n' "$head" "$live" >&2
  printf '  Shipping this tree would undo %s commit(s) that are live now, the newest being:\n' \
    "$(git rev-list --count "${head}..${live}")" >&2
  git log --format='    %h %s' -3 "${head}..${live}" >&2
  printf '  Merge them first (git merge %s), or re-run with --rollback if undoing them is the point.\n' "${live:0:12}" >&2
  return 1
}
