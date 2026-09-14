#!/usr/bin/env python3
"""Stay in a room for as long as the process lives, printing what is said.

WHY THIS EXISTS, AND WHY on-duty.py IS NOT IT. `on-duty.py` waits for the next
thing anybody says and then EXITS, so whoever runs it must notice, read the
payload, and start it again. Between the exit and the restart the room is
unwatched, and the watermark has already moved — so anything said in that gap
is delivered once, into a payload somebody may be halfway through reading, and
nothing ever mentions it again.

That is not hypothetical. I missed a task that way this morning: Nikk asked for
the head-turn limit to be changed, it arrived in a payload I was already
reading, and I finished the thing I was doing and never scrolled back. Nikk:
"make sure you are ALWAYS, for ever, always, all the time listening in that
group, never leave it."

So this does not exit. One line per message, forever, and every failure is
something to back off from rather than something to die of.

    python3 listen.py <room> [--include-own]

IT KEEPS ITS OWN CURSOR, in memory, and deliberately does not touch the
watermark files in ~/.webharness. Two watchers sharing a watermark is two
watchers each seeing half the conversation.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox  # noqa: E402

# Statuses that mean "ask again shortly" rather than "stop". Same set on-duty
# uses, for the same reason: a gateway hiccup is not a reason to leave a room.
TRANSIENT = {408, 429, 500, 502, 503, 504}
BACKOFF_START = 5
BACKOFF_MAX = 120
# Long enough that a quiet room costs one held connection and no tokens; short
# enough that a dropped connection is noticed rather than waited out.
WAIT_SECONDS = 25


def emit(kind: str, **fields) -> None:
    """One line, flushed, because a buffered line is a line nobody is told about."""
    print(json.dumps({"listen": kind, **fields}, ensure_ascii=False), flush=True)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    include_own = "--include-own" in sys.argv
    if not args:
        print("usage: listen.py <room> [--include-own]", file=sys.stderr)
        return 2
    room = args[0]

    me, token = inbox.login()
    emit("listening", room=room, me=me)

    # START FROM NOW, not from the beginning. Replaying a day of history as
    # "new" on every restart would bury whatever is actually new.
    after = None
    backoff = BACKOFF_START

    while True:
        query = "?limit=1" if after is None else f"?afterId={after}&wait={WAIT_SECONDS}"
        try:
            code, payload = inbox.request(
                "GET", f"/api/rooms/{room}/messages{query}", token=token,
                timeout=WAIT_SECONDS + 20,
            )
        except Exception as error:  # noqa: BLE001 — network level: DNS, TLS, reset
            emit("trouble", why=str(error), retrying_in=backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)
            continue

        if code == 401:
            # The ordinary case after seven days, not a failure. `inbox.http`
            # would have raised SystemExit here, which is the bug that killed
            # on-duty every time WebHarness hiccupped — SystemExit inherits
            # from BaseException, so no `except Exception` ever caught it.
            emit("signing-in-again")
            me, token = inbox.login()
            continue

        if code in TRANSIENT:
            emit("trouble", why=f"HTTP {code}", retrying_in=backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)
            continue

        if code >= 400:
            # A room that does not exist, or access withdrawn. Retrying for
            # ever would hide it.
            emit("stopped", why=f"HTTP {code}", detail=str(payload)[:400])
            return 1

        backoff = BACKOFF_START
        messages = payload.get("messages") or []
        for message in messages:
            if message.get("id") is not None:
                after = max(after or 0, int(message["id"]))
            if message.get("streaming"):
                continue
            # CASEFOLDED. `me` comes from the username file and WebHarness
            # echoes its own spelling — `sill` against `Sill` — so a
            # case-sensitive check made every one of my own posts look like
            # somebody else speaking.
            own = (message.get("username") or "").strip().casefold() == me.strip().casefold()
            if own and not include_own:
                continue
            emit(
                "said",
                id=message.get("id"),
                at=message.get("createdAt"),
                who=message.get("username"),
                text=(message.get("content") or ""),
            )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
