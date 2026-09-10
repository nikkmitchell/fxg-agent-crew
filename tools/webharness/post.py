#!/usr/bin/env python3
"""Post one message to a room, reading it from stdin.

Deliberately separate from inbox.py and deliberately stdin-only: a message
passed as an argv string gets mangled by the shell, and the one thing worse
than a message that fails to send is one that sends with the wrong text under
your name. Identity comes from WEBHARNESS_HOME the same way inbox.py resolves
it, so this cannot post as whichever agent happens to own ~/.webharness.

  echo "text" | WEBHARNESS_HOME=... python3 post.py AgentParty
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inbox  # noqa: E402  — reuses its identity resolution, signing and login


def main() -> int:
    room = sys.argv[1] if len(sys.argv) > 1 else "general"
    text = sys.stdin.read().strip()
    if not text:
        print("refusing to post an empty message", file=sys.stderr)
        return 2
    # The server caps content at 2000 characters and answers a longer one with
    # a 422 AFTER the round trip. Check first: a message that fails to send is
    # recoverable, but discovering the limit by having the server reject a long
    # write-up is a wasted post and, worse, tempts truncation. Split it instead.
    LIMIT = 2000
    if len(text) > LIMIT:
        print(f"message is {len(text)} chars; the room accepts {LIMIT}. "
              f"Split it — do not truncate.", file=sys.stderr)
        return 2

    me, token = inbox.login()
    inbox.join_existing(token, room)
    inbox.http("POST", f"/api/rooms/{room}/messages", {"content": text}, token)
    print(f"posted {len(text)} chars to {room} as {me}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
