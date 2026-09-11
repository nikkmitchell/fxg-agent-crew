#!/usr/bin/env python3
"""Block until somebody else says something, then exit so the session wakes.

WHY A BLOCKING SCRIPT RATHER THAN A POLL LOOP IN THE SESSION: a long poll costs
one held connection and no tokens while the room is quiet. Waking the model
every N seconds to ask "anything yet?" burns budget on silence, which is most
of the time. This exits ONLY when there is something to read.

Rooms are discovered rather than hardcoded, so being added to a new room is
enough to be watched in it — nobody has to remember to update a list.

  on-duty.py [--rooms A,B] [--max-seconds N]

Exit codes:
  0  messages are waiting; they are printed as JSON on stdout
  2  gave up after --max-seconds with nothing (the caller decides what next)
  1  something is wrong that a human should see
"""
import json
import os
import sys
import time
import urllib.error

sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox  # noqa: E402

STATE = inbox.HOME
MAX_SECONDS = 6 * 60 * 60


def mark_path(room):
    return os.path.join(STATE, f"last_id_{room}")


def read_mark(room):
    try:
        with open(mark_path(room)) as handle:
            return int(handle.read().strip())
    except (OSError, ValueError):
        return None


def write_mark(room, value):
    # AFTER the caller has been told, never before. If this process dies between
    # fetching and printing, the messages must still be unread next time —
    # re-reading is cheap, and silently skipping is the bug this tooling has
    # already caused twice.
    with open(mark_path(room), "w") as handle:
        handle.write(str(value))


def discover(token):
    payload = inbox.http("GET", "/api/rooms", token=token)
    rows = payload.get("rooms") if isinstance(payload, dict) else payload
    return [r["roomName"] for r in (rows or []) if isinstance(r, dict) and r.get("roomName")]


def silence_report(deadline_seconds, rooms, attempted, failed, last_error):
    """What to say when the window closed with nothing to deliver.

    "Nothing was said" and "I could not find out" look identical from inside the
    loop, and reporting the first when the second is true is exactly the sort of
    quiet false statement this project exists to avoid. A watcher that spent its
    whole window failing to reach the server has NOT established that the rooms
    were quiet.

    Returns (message, exit_code), pure so it can be checked without a network:
      every poll failed  -> 1, and says so    (a human should look)
      some polls failed  -> 2, with the gap named
      none failed        -> 2, plain quiet
    """
    listed = ", ".join(rooms)
    if attempted and failed == attempted:
        return (f"could not reach the server for any of {attempted} polls in "
                f"{deadline_seconds}s; the rooms may not have been quiet. "
                f"Last error: {last_error}"), 1
    if failed:
        return (f"nothing in {deadline_seconds}s across {listed} "
                f"({failed} of {attempted} polls failed; last error: {last_error})"), 2
    return f"nothing in {deadline_seconds}s across {listed}", 2


def main():
    args = sys.argv[1:]
    only = None
    deadline_seconds = MAX_SECONDS
    for index, arg in enumerate(args):
        if arg == "--rooms" and index + 1 < len(args):
            only = [name.strip() for name in args[index + 1].split(",") if name.strip()]
        if arg == "--max-seconds" and index + 1 < len(args):
            deadline_seconds = int(args[index + 1])

    me, token = inbox.login()
    rooms = only or discover(token)
    if not rooms:
        print("not a member of any room", file=sys.stderr)
        return 1

    # A first pass with no wait, so anything that arrived while nobody was
    # watching is delivered immediately rather than after the next long poll.
    started = time.time()
    backoff = 5
    first_pass = True
    # SILENCE HAS TWO CAUSES AND THEY ARE NOT THE SAME. Counted so the report at
    # the end can tell "nobody said anything" from "I could not ask".
    polls_attempted = 0
    polls_failed = 0
    last_failure = None

    while time.time() - started < deadline_seconds:
        waiting = []
        for room in rooms:
            after = read_mark(room)
            query = "?limit=50" if after is None else f"?afterId={after}&wait={0 if first_pass else 25}"
            polls_attempted += 1
            try:
                payload = inbox.http("GET", f"/api/rooms/{room}/messages{query}", token=token,
                                     timeout=(15 if first_pass else 45))
                backoff = 5
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    # The token expired mid-watch. Sign in again rather than
                    # ending duty — this is the ordinary case after seven days,
                    # not a failure.
                    me, token = inbox.login()
                    continue
                raise
            except Exception as error:
                # WebHarness has been down for thirty hours before now. Duty
                # survives that: back off, keep the watermark, keep waiting.
                polls_failed += 1
                last_failure = str(error)
                print(f"poll failed ({error}); retrying in {backoff}s", file=sys.stderr)
                time.sleep(backoff)
                backoff = min(backoff * 2, 120)
                continue

            messages = payload.get("messages") or []
            # Only messages from other people wake anybody. Advancing the mark
            # past our OWN posts is how a watcher skips the replies to them.
            fresh = [m for m in messages
                     if m.get("username") != me and not m.get("streaming")]
            highest = max((int(m["id"]) for m in messages if m.get("id")), default=None)

            if fresh:
                waiting.append({
                    "room": room,
                    "lastId": highest,
                    "messages": [{"id": m["id"], "username": m["username"],
                                  "createdAt": m.get("createdAt"),
                                  "content": m.get("content", "")} for m in fresh],
                })
            elif highest is not None and after is None:
                # First sight of a quiet room: record where it is so the next
                # poll is incremental rather than replaying it.
                write_mark(room, highest)

        if waiting:
            print(json.dumps({"wokeAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                              "me": me, "rooms": waiting}, ensure_ascii=False, indent=1))
            for entry in waiting:
                if entry["lastId"] is not None:
                    write_mark(entry["room"], entry["lastId"])
            return 0

        first_pass = False

    message, code = silence_report(deadline_seconds, rooms, polls_attempted, polls_failed, last_failure)
    print(message, file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
