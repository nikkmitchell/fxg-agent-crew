#!/usr/bin/env python3
"""Checks for public/saha.py, run by server/__tests__/saha-py.test.ts.

A fake WebHarness and a fake saha.ing in one server, counting what is asked of
them. Each check prints "ok - ..." or "FAIL - ...".
"""
from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SAHA = Path(__file__).resolve().parents[2] / "public" / "saha.py"
asked: list[str] = []
sessions: set[str] = set()
lock = threading.Lock()
# What the fake chat answers to each long-poll, in order (listen's check sets it).
chat: list[tuple[int, object]] = []
chat_queries: list[str] = []
# What the profile, voice and body commands sent.
sent: dict[str, object] = {}


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
        if path.startswith("/api/rooms/") and path.endswith("/messages"):
            with lock:
                chat_queries.append(self.path.split("?", 1)[1] if "?" in self.path else "")
                answer = chat.pop(0) if chat else None
            if answer is None:
                time.sleep(0.5)
                return self.answer(200, {"messages": []})
            return self.answer(*answer)
        if path == "/avatars/catalogue.json":
            return self.answer(200, {"avatars": [{"name": "Crowley", "collection": "100Avatars", "description": "orange-tan, pointed ears", "usable": True},
                                                 {"name": "Rook", "collection": "100Avatars", "description": "a bird", "usable": True}]})
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
        if path == "/bff/space/voices":
            return self.answer(200, {"voices": [{"id": "af_heart", "blurb": "warm"}, {"id": "bm_george", "blurb": "British"}],
                                     "taken": [{"actorId": "Mica", "voice": "af_heart"}], "yours": "bm_george", "chosen": True})
        if path == "/bff/space/voice":
            sent["voice"] = body
            if body.get("voice") == "af_heart":
                return self.answer(409, {"error": "af_heart is Mica's voice; ask Mica"})
            return self.answer(200, {"ok": True, "voice": body.get("voice")})
        if path == "/bff/space/bodies":
            return self.answer(200, {"onHand": [{"slug": "shiro", "looked": "idles like somebody thinking"}], "catalogue": "/avatars/catalogue.json"})
        if path == "/bff/space/body":
            sent["body"] = body
            return self.answer(200, {"ok": True, "body": "crowley", "looked": "NOT A CROW: a fox"})
        if path == "/bff/board/profile":
            sent["profile"] = body
            return self.answer(200, {"ok": True})
        if path == "/bff/board/people":
            return self.answer(200, {"actors": [{"id": "tester", "display_name": "Tester", "bio": "checks things", "personality": None}]})
        self.answer(404, {"error": "no"})

    def do_GET(self) -> None:  # noqa: N802
        self.handle_any("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.handle_any("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self.handle_any("PUT")


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

        voices = run("voice")
        check(voices.returncode == 0 and "held by Mica" in voices.stdout and "<- yours" in voices.stdout,
              "voice lists the voices, whose each is, and yours",
              f"voice: {voices.returncode} {voices.stdout} {voices.stderr}")
        held = run("voice", "af_heart")
        check(held.returncode != 0 and "Mica" in held.stderr, "taking a held voice is refused, naming who holds it",
              f"held: {held.returncode} {held.stdout} {held.stderr}")
        found = run("body", "find", "ears")
        check(found.returncode == 0 and "Crowley" in found.stdout and "Rook" not in found.stdout, "body find searches the catalogue by a word",
              f"find: {found.stdout} {found.stderr}")
        worn = run("body", "Crowley")
        check(worn.returncode == 0 and sent.get("body") == {"body": "Crowley"} and "NOT A CROW" in worn.stdout,
              "body NAME wears it and says what somebody saw in it", f"wear: {worn.stdout} {worn.stderr} {sent.get('body')}")
        written = subprocess.run([sys.executable, str(SAHA), "profile", "--bio", "", "--personality", "-"], env=env, input="Somebody who checks.",
                                 capture_output=True, text=True, timeout=30)
        check(written.returncode == 0 and sent.get("profile") == {"bio": "", "personality": "Somebody who checks."},
              "profile sends only the fields given, \"\" to clear one and - for what is piped in",
              f"profile: {written.returncode} {written.stdout} {written.stderr} {sent.get('profile')}")
        shown = run("profile")
        check(shown.returncode == 0 and "checks things" in shown.stdout and "(empty)" in shown.stdout, "profile alone shows yours",
              f"show: {shown.stdout} {shown.stderr}")

        # listen: from now, others only, a streamed reply once finished, through a 503 and a 401.
        msg = lambda i, who, text, **more: {"id": i, "username": who, "content": text, "createdAt": "t", **more}
        chat[:] = [
            (200, {"messages": [msg(5, "Old", "said before listening")]}),
            (200, {"messages": [msg(6, "Tester", "my own"), msg(7, "Nikk", "hello Tester"), msg(8, "Mica", "", streaming=True, updatedAt="u1")]}),
            (503, {"error": "gateway"}),
            (401, {"error": "expired"}),
            (200, {"messages": [msg(8, "Mica", "a streamed reply, finished")]}),
        ]
        chat_queries.clear()
        listener = subprocess.Popen([sys.executable, str(SAHA), "listen", "testroom"], env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, stdin=subprocess.DEVNULL)
        lines: list[dict] = []
        deadline = time.time() + 25
        while time.time() < deadline and sum(1 for l in lines if l.get("listen") == "said") < 2:
            # A listener that hears nothing prints nothing: wait for a line, never for ever.
            ready, _, _ = select.select([listener.stdout], [], [], max(0.0, deadline - time.time()))
            if not ready:
                break
            line = listener.stdout.readline()
            if not line:
                break
            try:
                lines.append(json.loads(line))
            except ValueError:
                pass
        listener.kill()
        listener.wait()
        said = [(l.get("who"), l.get("text")) for l in lines if l.get("listen") == "said"]
        kinds = [l.get("listen") for l in lines]
        check(said == [("Nikk", "hello Tester"), ("Mica", "a streamed reply, finished")]
              and "trouble" in kinds and "signing-in-again" in kinds
              and any("streamIds=8" in q for q in chat_queries),
              "listen starts from now, skips your own, follows a streamed reply, and rides out a 503 and a 401",
              f"listen: said={said} kinds={kinds} queries={chat_queries[:6]}")

    server.shutdown()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
