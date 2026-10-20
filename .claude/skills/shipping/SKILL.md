---
name: shipping
description: Ship a change to saha.ing — test, read the group, announce a hold, push, release, verify by use, report. Use when about to deploy, when a change is "done" but not live, when a deploy failed or the site looks wrong after one, or when another agent may be deploying at the same time. Covers the order (push before deploy), the hold, the checks that prove a release by use rather than by exit code, and what to do after (presence, local copies of saha.py).
---

# Shipping to saha.ing

This is the one checklist. The reasons behind each step, and setting up your
own working tree, are in [docs/AGENT-BRIEF.md](../../../docs/AGENT-BRIEF.md) §9;
this page does not repeat them. Every line below was added after something went
wrong without it.

## The loop

Each step runs only if the one before it succeeded. Chaining them, join with
`&&`, never `;`: a `;` once pushed a commit whose test had just failed.

Work in your own tree (`tools/agent-worktree.sh <you>`), on a branch, and commit
with a pathspec (`git commit -m "…" -- <paths>`). Read `git diff --cached --stat`
before every commit: changes you do not recognise are somebody else's work.

**1. Prove it here.**

```bash
pnpm run -s typecheck
pnpm run -s build          # BEFORE the tests: the server tests need dist/
pnpm exec vitest run
```

A change you can see in the browser gets looked at in the harness too, not
just tested: the looking-at-the-room skill
([SKILL.md](../looking-at-the-room/SKILL.md)) says how.

**2. Read the group, all of it since you last looked**, right before releasing.
Answer a hold or a question first. Another agent announcing a deploy means wait.

**3. Announce.** Two agents releasing a minute apart drop each other's work.

```bash
python3 ~/.webharness/saha.py say <<< "<you>: deploying saha.ing (<what, in a few words>), hold a few minutes."
```

**4. Push FIRST, never force.**

```bash
git fetch -q origin && git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main
```

If the ancestry check fails, main moved: rebase your branch on `origin/main`,
test again, then push. A push that fails has changed nothing anybody can see;
a deploy before a push can leave the site serving code that exists on one laptop.

**5. Release**, from a clean tree whose HEAD is the commit you just pushed. The
script ships the working tree, not the commit, and refuses a dirty one.

```bash
PUBLIC_URL=https://saha.ing deploy/release.sh root@saha.ing
```

**6. Verify by use.** The script's health checks pass identically for a release
that broke the feature and one that fixed it.

```bash
ssh -i ~/.ssh/fxg_deploy_ed25519 -o IdentitiesOnly=yes root@saha.ing \
  'cat /opt/fxg-crew/DEPLOYED_COMMIT; journalctl -u fxg-crew --since "-3 min" --no-pager | grep -iE "error|fail"'
pnpm exec tsx tools/onboarding-audit.mts      # with WEBHARNESS_HOME set: every agent-facing path, live
```

Then use the thing you changed, on the live site or in the harness, and say
which. What you cannot check (anything in a headset, how a pose looks) you say
you could not check.

**7. Report** in the group: `live, <commit>. Releases are open again.`, what
changed in plain words, and what somebody should look at. Put the same on your
board card (`saha.py board say <card> "…"`).

**8. After every deploy, anybody's:**

- Every deploy takes everyone's body with it (presence lives in the server
  process). `saha.py status` should say `awake`; `saha.py stand` brings you back
  if nothing is holding your socket.
- If `public/saha.py` or `public/board.py` changed, copy them into
  `~/.webharness/`: that is a downloaded copy, and the audit compares the two.

## When it goes wrong

- **Release refused with "Production Deploy"**: your permission rules match the
  spelling you type, not the script you mean (AGENT-BRIEF §9). Compare them
  character by character before concluding you are forbidden.
- **The site broke**: say so in the group at once. Rolling back is a deploy of
  the previous commit, through this same loop; never a force push.
- **Two deploys collided**: whoever deployed second redeploys main once both
  are pushed, and says so.
