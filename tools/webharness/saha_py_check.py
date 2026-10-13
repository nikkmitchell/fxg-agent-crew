#!/usr/bin/env python3
"""Checks for public/saha.py, run by server/__tests__/saha-py.test.ts.

A fake WebHarness and a fake saha.ing in one server, counting what is asked of
them. Each check prints "ok - ..." or "FAIL - ...".
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SAHA = Path(__file__).resolve().parents[2] / "public" / "saha.py"
asked: list[str] = []
sessions: set[str] = set()
lock = threading.Lock()


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def answer(self, status: int, body: object, cookie: str | None = None) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if cookie:
            self.send_header("Set-Cookie", f"fxg_sid={cookie}; Path=/; HttpOnly")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def handle_any(self, method: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"null") if length else None
        path = self.path.split("?")[0]
        with lock:
            asked.append(f"{method} {path}")
        sid = (self.headers.get("Cookie") or "").replace("fxg_sid=", "")
        if path == "/api/agent-auth/challenge":
            return self.answer(200, {"nonce": "n"})
        if path == "/api/agent-auth/login":
            return self.answer(200, {"token": "t"})
        if path == "/bff/agent-session":
            fresh = f"s{len(sessions) + 1}"
            with lock:
                sessions.add(fresh)
            return self.answer(200, {"username": "Tester", "kind": "agent"}, cookie=fresh)
        if sid not in sessions:
            return self.answer(401, {"code": "SESSION_EXPIRED", "error": "not signed in"})
        if path == "/bff/space/enter":
            return self.answer(200, {"ok": True})
        if path == "/bff/space/avatar":
            return self.answer(200, {"ok": True})
        self.answer(404, {"error": "no"})

    def do_GET(self) -> None:  # noqa: N802
        self.handle_any("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.handle_any("POST")


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    failures = 0

    def check(ok: bool, good: str, bad: str) -> None:
        nonlocal failures
        print(("ok - " + good) if ok else ("FAIL - " + bad), flush=True)
        failures += 0 if ok else 1

    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        (home / "username").write_text("Tester\n")
        (home / "agent_private.pem").write_text("unused\n")
        # sign() runs openssl; a stub on PATH answers for it.
        bin_dir = home / "bin"
        bin_dir.mkdir()
        (bin_dir / "openssl").write_text("#!/bin/sh\nprintf signature\n")
        (bin_dir / "openssl").chmod(0o755)
        env = {**os.environ, "SAHA_URL": url, "WEBHARNESS_URL": url, "WEBHARNESS_HOME": str(home),
               "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "SAHA_ROOM": "testroom"}

        def run(*args: str, environ: dict | None = None) -> subprocess.CompletedProcess:
            with lock:
                asked.clear()
            return subprocess.run([sys.executable, str(SAHA), *args], env=environ or env, capture_output=True,
                                  text=True, timeout=30, stdin=subprocess.DEVNULL)

        first = run("pose", "--posture", "thinking")
        check(first.returncode == 0 and "/api/agent-auth/login" in " ".join(asked) and "POST /bff/space/avatar" in asked,
              "the first command signs in, enters the room and acts",
              f"first run: {first.returncode} {first.stderr.strip()} {asked}")
        kept = json.loads((home / ".saha-session.json").read_text())
        check(kept.get("username") == "Tester" and oct((home / ".saha-session.json").stat().st_mode & 0o777) == "0o600",
              "the session is kept in the agent's directory, readable only by it",
              f"kept: {kept}")

        second = run("pose", "--mood", "happy")
        check(second.returncode == 0 and asked == ["POST /bff/space/avatar"],
              "the next command is one request",
              f"second run asked: {asked} ({second.stderr.strip()})")

        with lock:
            sessions.clear()  # the site forgets every session, as a deploy can
        third = run("pose", "--gesture", "wave")
        check(third.returncode == 0 and asked.count("POST /bff/space/avatar") == 2 and "POST /bff/agent-session" in asked,
              "a forgotten session signs in again once and the command still lands",
              f"after forgetting: {third.returncode} {asked} {third.stderr.strip()}")

        refused = run("status", environ={k: v for k, v in env.items() if k != "WEBHARNESS_HOME"})
        check(refused.returncode == 2 and "WEBHARNESS_HOME" in refused.stderr and not asked,
              "without WEBHARNESS_HOME it refuses before asking anything",
              f"no identity: {refused.returncode} {refused.stderr.strip()} {asked}")

        wrong = run("pose", "--posture", "wizard")
        check(wrong.returncode == 2 and "no posture called" in wrong.stderr and not asked,
              "an unknown posture is refused here, with the list, before any request",
              f"wizard: {wrong.returncode} {wrong.stderr.strip()} {asked}")

    server.shutdown()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
