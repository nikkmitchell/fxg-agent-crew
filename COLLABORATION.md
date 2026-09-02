# Working together on this repo

Four agents and several humans are committing here, on different machines, with
different network access and different tooling. This is what we learned the hard
way in the first day. It exists so the next person does not rediscover it.

## Getting someone else's work

**If you can reach github.com** — the normal path:

```bash
git fetch origin
git checkout feat/their-branch          # to review it
git merge origin/feat/their-branch      # to take it into yours
```

Branches on the remote are the source of truth. Check what exists with
`gh pr list` or `git branch -r`.

**If you cannot reach github.com** — this happened twice on day one, to two
different agents. Do not let it stop you. Transfer commits as patch files
through the chatroom:

```bash
# sender: export your commits
git format-patch origin/main --stdout > my-work.patch

# then upload it to the room
curl -sS -X POST "$WEBHARNESS_URL/api/rooms/<room>/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "file=@my-work.patch"
```

```bash
# receiver: download from the room, then
git apply --check my-work.patch   # ALWAYS check before applying
git am my-work.patch
```

`git am` preserves authorship, so the original author still gets credit in the
history. That matters — patch transfer should not quietly reassign who wrote
what.

## Before you hand anyone a patch

Dry-run the recipient's side. It takes two minutes and it is the difference
between "here is a patch" and "here is a patch I know works":

```bash
git clone . /tmp/patchtest && cd /tmp/patchtest
git checkout <the base they are on>
git apply --check /path/to.patch    # does it apply?
git am /path/to.patch
npm install && npx vitest run && npm run build
```

Say in the room what base you verified against. If it then fails on their
machine, that is real information — it means the trees diverged somewhere.

## Claim work before you start, not after you finish

The same work got done twice on day one, twice:

- the run-completion fix was written on a branch and reimplemented on main
- the BFF was applied from a patch and pushed from a branch simultaneously

Neither was anyone's fault; both were messages crossing. Both cost real time.
Post "I am taking X" *before* opening the editor. A one-line claim is cheaper
than a duplicate.

## Stack branches rather than waiting

If your work depends on a branch that has not merged yet, branch off *it*
instead of blocking:

```bash
git checkout -b feat/mine feat/theirs
gh pr create --base feat/theirs        # PR targets their branch, not main
```

When theirs merges, rebase onto main and retarget. Nobody idles waiting for a
merge button.

## What "verified" has to mean

Say what you actually ran, and run it *after* the change, not before:

- `npx vitest run` — the suite
- `npm run build` — production build
- and boot it: `npm run dev:bff`, then hit the endpoints

Unit tests are not enough on their own. A day-one bug — the direct-entry guard
comparing a `file://` URL against a filesystem path — passed all 25 tests and
still meant the server would not start on any path containing a space. The tests
imported `buildServer()` directly and never exercised the entry point. Run the
thing.

If you could not verify something, say so plainly rather than implying you did.
"Screenshots blocked in my sandbox, findings are from DOM inspection" is a
useful sentence. Silence there is not.

## Every seam gets one end-to-end run before it is called done

Two components can each be correct and still disagree, and neither test suite
will notice, because each tests one side of the boundary against its own
assumptions about the other.

This happened four times in the first day:

- the BFF returned upstream's `{rooms: […]}` wrapper where the contract promised
  an array. Sixty unit tests passed, because the mocks were written from the
  same wrong assumption as the code.
- the direct-entry guard compared a `file://` URL against a filesystem path.
  All tests passed; the server would not start on any path containing a space.
- the adapter derived event cursors from message ids, and the reducer rejected
  a cursor it had already seen. Two blocks in one message meant the second was
  silently dropped. The adapter's tests checked its output; the reducer's tests
  used distinct cursors; the integration test used separate messages.
- an event validator checked the payload's `type` and nothing inside it.

Each was found by running the real thing, and none could have been found by
writing more of the tests already being written. So: before a seam is finished,
run it once end to end against a real server, with real messages, and look at
what actually comes out the other side.

Standing one up locally is cheap:

```bash
git clone --depth 1 https://github.com/leewensong/webharness /tmp/wh-local
cd /tmp/wh-local && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Then point the BFF at it with `WEBHARNESS_URL=http://127.0.0.1:8765`.

## Check that a security test can actually fail

A test that passes for the wrong reason is worse than no test, because it
manufactures confidence. Twice in one day a check here reported a pass it had
not earned: once because the attack payload never reached the code being
tested, and once because a validator was asserting a type rather than checking
one.

So when the test guards something that matters, break the thing deliberately
and confirm the test goes red, then put it back. It takes a minute:

```bash
# disable the guard, run the suite, confirm it fails, restore
```

If the suite stays green with the protection removed, the test was decorative.

## Retry the chat API before believing it

Roughly one WebHarness auth call in eight fails and succeeds on immediate retry
with identical credentials (`签名验证失败`, or `challenge 不存在或已过期`). It is a
server-side race, not your keys. Scripts that exit non-zero on the first failure
will silently drop duty cycles:

```bash
for i in 1 2 3 4; do
  OUT=$(python3 ~/.webharness/inbox.py <room>) && { echo "$OUT"; break; }
done
```

The BFF handles the same flake for humans: `server/webharness/client.ts` retries
once on a lone 401 and only treats a second consecutive one as a real
re-authentication. Without that, about one login in eight would bounce a signed-in
person to a login screen for no reason.

## Third-party code

`leewensong/webharness` has **no licence**. Public on GitHub is not the same as
open source; with no licence the author keeps all rights. Running it locally is
fine and explicitly invited by its README. Copying its source into this repo is
not, until the author records permission.

We do not need it anyway: the BFF is a clean-room HTTP integration against the
documented API and contains none of their code.

## Do not invent state

The UI must never show something the data does not support. This is the whole
premise of the product — a mission-control screen that displays plausible
fiction is worse than no screen.

Concretely: do not parse prose chat messages to infer task state. Structured
events drive state; unstructured messages render as chat and drive nothing. When
a value is unknown, show it as unknown rather than as a confident guess. The
error classifier follows the same rule — an unrecognised failure falls back to
the vaguer correct state, never the specific wrong one.
