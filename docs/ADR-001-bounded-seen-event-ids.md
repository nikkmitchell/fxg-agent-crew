# ADR-001: seenEventIds is unbounded, deliberately, for now

**Status:** accepted — bounding deferred until the adapter's ordering key is final

## Context

`CrewState.seenEventIds` grows without limit. Every event id is retained forever
so that replaying a delivery window cannot apply the same event twice. Other
collections in the reducer are capped (`rejectedEvents` at 50, `messages` at
500); this one is not, so a long-lived dashboard polling a busy room leaks
slowly.

## The attempt that was reverted

A cursor-bounded eviction was written and merged into a branch: keep any id
whose embedded message id is at or above the lowest per-source cursor, on the
reasoning that anything below it cannot legitimately be re-delivered.

It was wrong in four ways, all confirmed by running it rather than by reading
it:

1. **Replay stopped being idempotent above the threshold.** Evicted ids returned
   as *stale-cursor rejections*, and rejection mutates state — it appends to
   `rejectedEvents` and re-adds the id. Measured at 6000 events: before replay
   `{seen: 1000, rejected: 0}`, after replay `{seen: 6000, rejected: 50}`. The
   states were not equal. The change broke the single property this reducer
   exists to provide.

2. **An inactive source froze eviction permanently.** The bound used
   `min(cursors)`, so one source that stopped emitting held the floor down
   forever. Measured: 6000 ids retained with a single quiet source.

3. **Unrecognised id formats were never evicted at all**, by design — we cannot
   prove an id we cannot parse is unreachable. Measured: 6000 retained. So the
   leak persisted for exactly the inputs we control least.

4. **The id format is about to change.** The adapter work makes ids
   room-scoped, so any parsing rule written now is invalidated by it.

The test asserting the fix was safe was **vacuous**: it replayed 20 events
against a 5000-event threshold, so the pruning branch never executed. It passed
for the wrong reason, which is worse than failing.

## Decision

Remove the pruning. Keep `seenEventIds` unbounded and say so in the code.

A slow leak is preferable to silently breaking replay idempotency. The leak is
visible, bounded by session length, and costs memory; the correctness bug was
invisible, corrupted state, and was masked by a passing test.

## Revisiting this

Bound it once the adapter's room-scoped ordering key is settled. Any future
attempt must be tested with:

- a replay **above** the threshold, asserting byte-identical state
- an inactive source present, asserting eviction still progresses
- unknown id formats, asserting they are bounded
- ids from multiple rooms, asserting no cross-room collision
- multi-block messages, since several events share a cursor

Each of those was a real failure mode of the reverted attempt, and none of them
was covered by the test that claimed it worked.
