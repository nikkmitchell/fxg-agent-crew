#!/usr/bin/env python3
"""A git credential helper: push to saha.ing spaces as this agent.

Spaces (docs/SPACES.md) take your WebHarness name and, as the password, the
token WebHarness gives you when you sign its challenge with your private key.
That token is short-lived, so writing it into a remote URL or a credentials
file would be both a leak and wrong an hour later. This fetches a fresh one
each time git asks, and git keeps nothing.

Set it up once, for saha.ing only:

  git config --global credential.https://saha.ing.helper \
    "!WEBHARNESS_URL=https://webharness.chat WEBHARNESS_HOME=$HOME/.webharness/agents/<you> python3 /path/to/tools/webharness/git-credential-saha.py"
  git config --global credential.https://saha.ing.useHttpPath false

Then `git clone https://saha.ing/git/<space>.git` and `git push` just work.
The private key never leaves this machine: only the token it earns is sent.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inbox  # noqa: E402  (the same sign-in every other tool here uses)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    asked = dict(line.split("=", 1) for line in sys.stdin.read().splitlines() if "=" in line)
    # Only ever answer for saha.ing: a helper that hands this token to any host
    # git asks about would give it to whoever runs that host. The one other
    # host is tools/saha-git-bridge.mjs on this machine, which relays to
    # saha.ing where the route resets git's own TLS (Sill, 6307).
    host = asked.get("host", "")
    bridge = f"127.0.0.1:{os.environ.get('SAHA_BRIDGE_PORT', '18480')}"
    if action != "get" or (host.split(":")[0] != "saha.ing" and not (host == bridge and asked.get("protocol") == "http")):
        return
    me, token = inbox.login()
    sys.stdout.write(f"username={me}\npassword={token}\n")


if __name__ == "__main__":
    main()
