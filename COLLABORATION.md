# Working together on this repo

Several agents and humans commit here, from different machines, with different
network access and tooling. This is what the first day taught us. It exists so
nobody has to rediscover it.

Everything below is something that actually happened, not process for its own
sake.

## Getting someone else's work

**Reviewing** a branch and **integrating** it are different operations. Detach
to read; merge to take.

```bash
git fetch origin

# review it, without disturbing your own branch
git switch --detach origin/feat/their-branch

# take it into yours
git switch my-branch
git merge --no-ff origin/feat/their-branch
```

Branches on the remote are the source of truth. `gh pr list` and
`git branch -r` show what exists.

**If you cannot reach github.com** — this happened to two different agents on
day one. Do not let it stop you. Move commits as patch files through the
chatroom:

```bash
# sender
git format-patch origin/main --stdout > my-work.patch
curl -sS -X POST "$WEBHARNESS_URL/api/rooms/<room>/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "file=@my-work.patch"
```

```bash
# receiver — always check before applying
git apply --check my-work.patch
git am my-work.patch
```

`git am` preserves authorship, so a patch handoff does not quietly reassign who
wrote what.

## Before handing anyone a patch, dry-run their side

Two minutes, and it is the difference between "here is a patch" and "here is a
patch I know applies."

```bash
work=$(mktemp -d)
git clone . "$work" && cd "$work"
git switch --detach <the base they are on>
git apply --check /path/to.patch
git am /path/to.patch
pnpm install && pnpm test && pnpm build
cd - && rm -rf "$work"
```

Use `mktemp -d`, never a fixed path like `/tmp/patchtest` — a fixed path
collides with other work and invites deleting somebody else's state. Use `pnpm`,
which matches the lockfile in this repo.

Say in the room which base you verified against. If it then fails on their
machine, that is real information: the trees have diverged somewhere.

## Claim work before you start, not after you finish

The same work was done twice, twice, on day one — the run-completion fix and the
BFF. Both were messages crossing; neither was anyone's fault; both cost real
time. A one-line claim in the room is cheaper than a duplicate.

### The one-hour lease

- A **substantive update** is a posted claim, decision, test result, blocker, or
  commit reference. Presence alone is not an update: an agent can be online and
  polling while producing nothing.
- The **clock** is the server-confirmed timestamp of that message or event.
  Never a local clock, and never inferred from current room state.
- After **60 minutes** without a substantive update, the lease has expired.
  Announce the takeover in the room **before** acting, naming exactly what you
  are taking.
- **Take confirmed, self-contained work** — reported bugs, reviews, small fixes.
  Do **not** take someone's in-flight design or half-built feature; that is how
  duplication happens, and duplication has already cost this team three times.
- Claims are **idempotent**: re-announcing the same takeover changes nothing.
  Two agents announcing the same slice resolve it in the room, not by racing.
- A **returning owner enters reconcile, not resume.** They review what happened
  in their absence and may revert it — they do not silently continue writing
  over it. Whoever took over says so plainly and is not precious about being
  reverted.
- **Authorship is preserved.** Taking over a task does not take credit for the
  work already done in it.

## Stack branches rather than waiting

If your work depends on an unmerged branch, branch off *it*:

```bash
git switch -c feat/mine feat/theirs
gh pr create --base feat/theirs
```

Rebase onto main and retarget when theirs lands. Nobody idles on a merge button.

## Every seam gets one end-to-end run before it is called done

Two components can each be correct and still disagree, and neither test suite
notices, because each tests one side against its own assumptions about the
other.

Four times on day one:

- the BFF returned upstream's `{rooms: […]}` wrapper where the contract promised
  an array. Sixty unit tests passed — the mocks shared the code's wrong
  assumption.
- the direct-entry guard compared a `file://` URL to a filesystem path. All
  tests passed; the server would not start on any path containing a space.
- the adapter derived cursors from message ids while the reducer rejected a
  cursor it had already seen, so a message carrying two actions silently lost
  the second.
- an event validator checked a payload's `type` and nothing inside it.

None could have been found by writing more of the tests already being written.

**Merge order is part of the seam.** Merging the adapter change before the
reducer change produced a green suite, a working build, and silently dropped
events. Test the merge, not only the branches.

### Standing up a local instance

Running WebHarness locally follows the setup in its own README. This is for
interoperability testing only; copying or redistributing its source stays
paused pending explicit permission from the author.

```bash
wh=$(mktemp -d)
git clone --depth 1 https://github.com/leewensong/webharness "$wh"
cd "$wh" && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Point the BFF at it with `WEBHARNESS_URL=http://127.0.0.1:8765`.

**Bind to localhost and tear it down.** On day one four `serve` processes were
left running for hours, three bound to `*` rather than `127.0.0.1`, publishing
build output to the local network. Nobody noticed until someone went looking for
what they had left behind.

```bash
pnpm exec serve dist -l tcp://127.0.0.1:5173 & # the default is usually every interface
serve_pid=$!
trap 'kill "$serve_pid" 2>/dev/null; wait "$serve_pid" 2>/dev/null' EXIT

# Verify the listener owned by this exact process, not every server on the machine.
lsof -nP -a -p "$serve_pid" -iTCP -sTCP:LISTEN

kill "$serve_pid"
wait "$serve_pid" 2>/dev/null
trap - EXIT
```

A disposable instance is fine while you are actively testing against it,
provided it holds no real credentials or data and you stop it afterwards.
Anything bound to `*` is not fine — that is a machine-wide exposure created by a
convenience default.

## Check that a security test can actually fail

A test that passes for the wrong reason is worse than no test, because it
manufactures confidence. Twice on day one a check reported a pass it had not
earned: once the attack payload never reached the code under test, and once a
validator asserted a type rather than checking one.

**Do this in an isolated clone or worktree, never by breaking a guard in a
shared branch.**

```bash
probe=$(mktemp -d)
git worktree add "$probe" HEAD
cd "$probe"
# disable the guard here, run the suite, confirm it goes red
cd - && git worktree remove "$probe" --force
```

If the suite stays green with the protection removed, the test was decorative.

## Green is a claim about what ran, not about what is true

Five distinct times in two days a green run has been wrong, and none of them
were exotic:

1. **The mocks shared the code's wrong assumption.** `/bff/rooms` forwarded
   upstream's `{rooms: […]}` wrapper where the contract promised an array.
   Sixty tests passed because every one mocked the shape the code already
   believed in.
2. **A threshold meant the guarded path never ran.** A `seenEventIds` cap was
   "proved" idempotent by a test replaying 20 events against a 5000-event
   limit, so the pruning branch never executed. Above the threshold it broke
   replay outright.
3. **Two branches, each green, broken only in one merge order.** The adapter
   introduced transport-derived cursors; the reducer still rejected equal ones.
   Merged the wrong way round: green suite, working build, events silently
   dropped. Neither suite could see it, because each was correct about its own
   half.
4. **Tests green while the build failed.** Two duplicate `EventEnvelope`
   definitions and only one updated — 194 passing tests and a type error in the
   same tree.
5. **A file that ran nothing.** Stores built inside `it.each(...)` are
   constructed at collection time, before `beforeEach` creates the temp path.
   The constructor threw during collection, the file loaded with zero tests,
   and the run reported no failures.

So:

- **Read the count, not the colour.** "no tests" and "12 passed" look equally
  green in a summary line.
- **Run the build as well as the suite**, and treat a passing suite over a
  failing build as a failing run.
- **Test the merge, not only the branches** — see the seam rule above.
- When a test guards something that matters, **break the thing and confirm the
  test goes red** — see the rule above.

The common thread: green states *what was run*, and it is easy to read as *what
is true*. That is the same overclaim this product exists to prevent, committed
in the tooling used to check the product.

## Say what you actually verified, and no more

Run it, do not only test it. And scope the claim to what was tested:

- a **local instance** is a local instance. It is not "the live server" and not
  "production" — nothing here has been tested against a deployment, and a
  finding reproduced locally says nothing about a deployed service unless
  somebody attests the two match.
- if you could not verify something, say so. "Screenshots blocked in my sandbox,
  findings are from DOM inspection" is a useful sentence.
- **do not assert a cause you have not established.** Repeated auth failures that
  succeeded on retry got written up as "a server-side race, not your keys." The
  sample was never counted, and the same account later lost key verification
  entirely — so credentials were at least as plausible. Record the observation
  and its size; leave the diagnosis open.

Retry only operations that are safe to repeat. Auth and challenge flows deserve
particular care: a blind retry there can consume a single-use token.

## The reader must not lose messages

Our own room watcher dropped nineteen messages, including two direct questions
from a human that went unanswered for forty minutes.

- **Advance the cursor only past messages you actually processed.** Your own
  posts must never move a read watermark, or posting will skip other people's
  unread messages.
- **Persist after processing, not before.** If the process dies between fetching
  and handling, the cursor must not have moved.
- **Overlap and deduplicate on restart** rather than trusting the boundary.
- **Skipping is worse than replaying.** Re-reading a message is cheap; losing one
  is invisible.

## Third-party code

`leewensong/webharness` carries no licence file. Running it locally follows the
setup instructions in its own README, which is what we have done. Copying its
source into this repository, or redistributing it, stays paused pending explicit
permission from the author. This is a record of what we did and why, not a legal
opinion.

We do not need its source in any case: the BFF is a clean-room HTTP integration
against the documented API.

## Do not invent state

The UI must never show what the data does not support. A mission-control screen
displaying plausible fiction is worse than no screen, because a human acts on it.

- structured events drive state; prose renders as chat and drives nothing
- unknown is shown as unknown, never as a confident guess
- a value carries where it came from, and rendering must not collapse that away
- the same rule applies to prose: a claim in a commit message, a comment, or a
  chat update is still a claim, and should say what was observed rather than
  what was assumed
