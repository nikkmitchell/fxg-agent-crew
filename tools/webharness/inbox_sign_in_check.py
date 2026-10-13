#!/usr/bin/env python3
"""Checks for inbox.login(), run by server/__tests__/inbox-sign-in.test.ts.

WebHarness keeps ONE outstanding challenge per username: asking for a second
replaces the first. So two processes signing in as the same agent at once
used to fail one of them with "签名验证失败" (measured 2026-10-14, four rounds
out of four). The fake server below keeps the same rule, and holds each login
open briefly so the sign-ins really do overlap.

Each check prints "ok - ..." or "FAIL - ...". The last one removes the lock
and expects failures, so this file cannot pass by never overlapping anything.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
challenges: dict[str, str] = {}
guard = threading.Lock()


class FakeWebHarness(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # quiet
        pass

    def answer(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        user = body.get("username", "")
        if self.path == "/api/agent-auth/challenge":
            nonce = uuid.uuid4().hex
            with guard:
                challenges[user] = nonce  # replaces any earlier one, as upstream does
            return self.answer(200, {"nonce": nonce})
        if self.path == "/api/agent-auth/login":
            time.sleep(0.15)  # long enough for a parallel sign-in to ask for its own challenge
            with guard:
                current = challenges.pop(user, None)
            if current is None or body.get("signature") != "signed:" + current:
                return self.answer(401, {"detail": "签名验证失败"})
            return self.answer(200, {"token": "token-" + uuid.uuid4().hex})
        self.answer(404, {"detail": "no"})


CHILD = """
import contextlib, sys
sys.path.insert(0, {here!r})
import inbox
inbox.sign = lambda nonce, key: "signed:" + nonce
if {unlocked!r}:
    inbox._one_sign_in_at_a_time = contextlib.nullcontext
try:
    inbox.login()
    print("signed in")
except SystemExit as error:
    print("refused", error)
"""


def parallel_sign_ins(url: str, home: Path, count: int, unlocked: bool) -> list[str]:
    env = {**os.environ, "WEBHARNESS_URL": url, "WEBHARNESS_HOME": str(home)}
    code = CHILD.format(here=str(HERE), unlocked=unlocked)
    children = [
        subprocess.Popen([sys.executable, "-c", code], env=env, stdout=subprocess.PIPE, text=True)
        for _ in range(count)
    ]
    return [child.communicate(timeout=60)[0].strip() for child in children]


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeWebHarness)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        (home / "username").write_text("Tester\n")
        (home / "agent_private.pem").write_text("not used: sign() is replaced\n")

        locked = [line for _ in range(3) for line in parallel_sign_ins(url, home, 3, unlocked=False)]
        if all(line == "signed in" for line in locked):
            print("ok - nine sign-ins in parallel threes all succeed")
        else:
            failures += 1
            print("FAIL - parallel sign-ins were refused with the lock in place:", locked)

        unlocked = [line for _ in range(3) for line in parallel_sign_ins(url, home, 3, unlocked=True)]
        if any(line.startswith("refused") for line in unlocked):
            print("ok - without the lock the same sign-ins are refused, so the check above can fail")
        else:
            failures += 1
            print("FAIL - nothing overlapped even without the lock; the first check proves nothing:", unlocked)

    server.shutdown()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
