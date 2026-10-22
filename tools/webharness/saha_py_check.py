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
import gzip
import tempfile

# How many answers went gzipped because saha.py asked (the last check reads it).
gzipped = [0]
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SAHA = Path(__file__).resolve().parents[2] / "public" / "saha.py"
PUBLIC = SAHA.parent
asked: list[str] = []
sessions: set[str] = set()
lock = threading.Lock()
# What the fake chat answers to each long-poll, in order (listen's check sets it).
chat: list[tuple[int, object]] = []
chat_queries: list[str] = []
# The room's real newest messages, answered to a listener's ?limit=20 check (what its long-poll missed).
tail: list[dict] = []
# What the profile, voice and body commands sent.
sent: dict[str, object] = {}
# Rooms the fake chat has, and which the agent is a member of (join's check).
rooms = {"testroom": True, "openroom": False}
# Pings the fake room's socket heard (stand's check).
pings: list[bytes] = []
# How many times arrivals asked who is here, and whether its scene is on.
presence_calls: list[int] = []
presence_scene: list[int] = []
# What board priority and kind sent.
patches: list[object] = []
# Ownership asked of board cards: (card, action).
ownership: list[tuple[str, object]] = []
# What go played, in order (go's check).
go_moves: list[object] = []
# What screen sent: (content type, bytes) per picture, ("DELETE", 0) when taken down.
frames: list[tuple[str, int]] = []
# The room each session last entered: saha.ing holds a session in ONE room.
entered: dict[str, str] = {}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def answer(self, status: int, body: object, cookie: str | None = None) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        # As saha.ing does since d963fa7: gzip for a client that asks, so every check below
        # also proves saha.py asks for it and unpacks it.
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            gzipped[0] += 1
            raw = gzip.compress(raw)
            self.send_header("Content-Encoding", "gzip")
        if cookie:
            self.send_header("Set-Cookie", f"fxg_sid={cookie}; Path=/; HttpOnly")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def handle_any(self, method: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw) if raw else None
        except ValueError:
            body = raw  # a picture, not JSON (screen's check)
        path = self.path.split("?")[0]
        with lock:
            asked.append(f"{method} {path}")
        sid = (self.headers.get("Cookie") or "").replace("fxg_sid=", "")
        if path == "/api/agent-auth/challenge":
            return self.answer(200, {"nonce": "n"})
        if path == "/api/agent-auth/login":
            return self.answer(200, {"token": "t"})
        if path.startswith("/api/rooms/") and not path.endswith("/messages") and method == "GET":
            name = path.split("/")[3]
            if name not in rooms:
                return self.answer(404, {"detail": "房间不存在"})
            return self.answer(200 if rooms[name] else 403, {"detail": "ok" if rooms[name] else "尚未加入"})
        if path == "/api/rooms" and method == "POST":
            sent["join"] = body
            rooms[body["roomName"]] = True
            return self.answer(200, {"roomName": body["roomName"], "created": False})
        if path.startswith("/api/rooms/") and path.endswith("/messages"):
            with lock:
                query = self.path.split("?", 1)[1] if "?" in self.path else ""
                chat_queries.append(query)
                if tail and "limit=20" in query:
                    return self.answer(200, {"messages": list(tail)})
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
        if path == "/bff/space/socket":
            # A room socket: switch, hear one masked ping, then close, so the holder must stand up again.
            self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            self.wfile.flush()
            head = self.rfile.read(2)
            size = head[1] & 0x7F
            mask = self.rfile.read(4)
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(size)))
            with lock:
                pings.append(data)
            self.wfile.write(bytes([0x88, 0x00]))
            self.wfile.flush()
            self.close_connection = True
            return
        if path == "/bff/space/presence":
            if presence_scene:  # arrivals' check: somebody new is there from the second look on
                with lock:
                    presence_calls.append(1)
                    calls = len(presence_calls)
                people = [{"actorId": "Tester", "connected": True, "kind": "agent"}, {"actorId": "Nikk2", "connected": True, "kind": "human"}]
                if calls >= 2:
                    people.append({"actorId": "Newcomer", "connected": True, "kind": "human"})
                return self.answer(200, {"people": people})
            return self.answer(200, {"people": [{"actorId": "Tester", "connected": False}]})
        if path == "/bff/space/showing":
            if method == "PUT":
                sent["showing"] = body
                return self.answer(200, {"ok": True})
            return self.answer(200, {"showing": {"projectId": None}})
        if path == "/bff/board/projects" and method == "GET":
            return self.answer(200, {"projects": [{"id": "saha-ing", "name": "saha.ing"}]})
        if path == "/bff/board/projects" and method == "POST":
            sent["project"] = body
            return self.answer(201, {"ok": True})
        if path == "/bff/board/projects/saha-ing":
            return self.answer(200, {"tasks": [
                {"id": "c1", "status": "review", "owners": ["Sill"], "title": "a card in review", "priority": 2, "kind": "build",
                 "points": None, "acceptedBy": ["Sill"], "blocker": None, "comments": [{"author_id": "Mica", "body": "looks right"}]},
                {"id": "c2", "status": "done", "owners": [], "title": "a finished card"}]})
        if path.startswith("/bff/board/tasks/") and method == "PATCH":
            with lock:
                patches.append(body)
            return self.answer(200, {"ok": True})
        if path.startswith("/bff/board/tasks/") and path.endswith("/ownership"):
            with lock:
                ownership.append((path.split("/")[4], (body or {}).get("action")))
            return self.answer(200, {"ok": True})
        if path.startswith("/bff/board/tasks/") and path.endswith("/status"):
            sent["status"] = body
            return self.answer(200, {"ok": True})
        if path == "/bff/board/tasks" and method == "POST":
            sent["task"] = body
            return self.answer(201, {"result": "c3"})
        if path == "/bff/space/enter":
            with lock:
                entered[sid] = body["roomName"]
            return self.answer(200, {"ok": True})
        if path == "/bff/space/avatar":
            return self.answer(200, {"ok": True})
        if path == "/bff/space/go":
            query = urllib.parse.parse_qs(self.path.partition("?")[2])
            to_play = "White" if go_moves else "Black"
            mine = (query.get("as") or [""])[0].capitalize()
            return self.answer(200, {"tables": [{"id": "t1abcdef", "size": 9, "surface": "bamboo", "players": ["Black", "White"],
                                                 "stones": len(go_moves), "revision": len(go_moves), "ended": False, "toPlay": to_play,
                                                 "lifted": None, **({"yourColour": mine, "yourTurn": mine == to_play} if mine else {}),
                                                 "text": f"BOARD with {len(go_moves)} stones; to play: {to_play}"}]})
        if path == "/bff/space/items/t1abcdef/action":
            with lock:
                go_moves.append(body)
            return self.answer(200, {"item": {}})
        if path == "/bff/space/screens/frame" and method == "PUT":
            with lock:
                frames.append((self.headers.get("Content-Type") or "", len(body) if isinstance(body, bytes) else -1))
            return self.answer(200, {"ok": True})
        if path == "/bff/space/screens/frame" and method == "DELETE":
            with lock:
                frames.append(("DELETE", 0))
            return self.answer(200, {"ok": True})
        if path == "/bff/space/screens":
            live = [one for one in frames if one[0] != "DELETE"] and frames[-1][0] != "DELETE"
            return self.answer(200, {"screens": [{"actorId": "Tester", "updatedAt": "2026-10-20T08:00:00Z"}] if live else []})
        if path == "/bff/space/screens/key":
            return self.answer(200, {"key": "k3y/with+odd=chars", "expiresAt": "2026-10-20T20:00:00Z"})
        if path == "/bff/space/memories" and method == "POST":
            sent["memory"] = body
            return self.answer(200, {"ok": True, "memory": {"id": "m1", **body}, "privacy": "shared: anybody in the room can read this."})
        if path == "/bff/space/memories" and method == "GET":
            return self.answer(200, {"memories": [{"id": "m1", "actorId": "Tester", "kind": "fact", "visibility": "shared",
                                                   "body": "the board moves any column to any other"}], "mine": 1})
        if path == "/bff/space/memories/m1" and method == "DELETE":
            return self.answer(200, {"ok": True, "forgotten": "m1", "alsoForgotten": []})
        if path == "/bff/space/touch-preferences" and method == "PUT":
            sent["touch"] = body
            return self.answer(200, {"ok": True, "preferences": body})
        if path == "/bff/space/touch-preferences/Tester":
            return self.answer(200, {"preferences": {"head": "likes"}})
        if path == "/bff/space/touches":
            return self.answer(200, {"touches": [{"id": 1, "agentId": "Tester", "by": "Nikk2", "part": "head",
                                                  "feeling": "likes", "at": "2026-10-20T07:00:00Z"}]})
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
        if path.startswith("/bff/space/registered/") and method == "PUT":
            sent.setdefault("registered", []).append((path, self.headers.get("Content-Type"), len(body) if isinstance(body, bytes) else body))
            if path.endswith("/thumbnail"):
                return self.answer(200, {"ok": True})
            return self.answer(201, {"ok": True, "replaced": False, "warnings": ["no blink"], "body": {"thumbnail": None}})
        if path == "/bff/space/meditation":
            if method == "POST":
                sent["meditation"] = body
                return self.answer(200, {"meditation": {}})
            return self.answer(200, {"meditation": {"shown": True, "startedAt": 1, "pausedAt": None, "pattern": "calm", "minutes": 10,
                                                    "guide": "arrive", "startedBy": "Nikk2", "together": ["Nikk2"],
                                                    "intentions": [{"by": "Nikk2", "word": "rest"}], "candles": [{}]}})
        if path == "/bff/space/follow" and method == "POST":
            sent["follow"] = body
            return self.answer(200, {"ok": True, "following": body.get("actor"), "side": "left", "because": body.get("because")})
        if path == "/bff/space/bowl":
            sent["bowl"] = body
            return self.answer(200, {"ok": True})
        if path == "/bff/space/utterances" and method == "GET":
            return self.answer(200, {"utterances": [{"id": 7, "actorId": "Nikk2", "say": "can you look?"},
                                                    {"id": 8, "actorId": "Tester", "say": "on it"}]})
        if path == "/bff/space/attending":
            sent["attending"] = body
            return self.answer(200, {"ok": True})
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

    def do_PATCH(self) -> None:  # noqa: N802
        self.handle_any("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self.handle_any("DELETE")


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
        kept_file = home / ".saha-session.testroom.json"
        kept = json.loads(kept_file.read_text()) if kept_file.exists() else {}
        check(kept.get("username") == "Tester" and oct(kept_file.stat().st_mode & 0o777) == "0o600",
              "the session is kept in the agent's directory, one per room, readable only by it",
              f"kept: {kept} {sorted(p.name for p in home.iterdir())}")

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

        # A one-off command in another room must not move this room's session:
        # entering evicts a session's socket from every other room, so a shared
        # session knocked `stand` out of its room (Sill, 2026-10-20).
        here_sid = json.loads(kept_file.read_text())["cookie"].split("=", 1)[1]
        elsewhere = run("pose", "--mood", "focused", environ={**env, "SAHA_ROOM": "otherroom"})
        check(elsewhere.returncode == 0 and "POST /bff/agent-session" in asked and entered.get(here_sid) == "testroom"
              and (home / ".saha-session.otherroom.json").exists(),
              "a command in another room uses that room's own session and leaves this one where it stands",
              f"elsewhere: {elsewhere.returncode} {asked} {entered} {elsewhere.stderr.strip()}")
        bare = {k: v for k, v in env.items() if k != "SAHA_ROOM"}
        moved = run("enter", "testroom", environ=bare)
        after = run("pose", "--mood", "happy", environ=bare)
        check(moved.returncode == 0 and after.returncode == 0 and asked == ["POST /bff/space/avatar"]
              and (home / ".saha-room").read_text().strip() == "testroom" and entered.get(here_sid) == "testroom",
              "without SAHA_ROOM a command goes to the room last entered on purpose, not one a one-off visited",
              f"home: {moved.returncode} {after.returncode} {asked} {moved.stderr.strip()} {after.stderr.strip()}")

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
        (home / "mine.vrm").write_bytes(b"glTF" + b"\0" * 60)
        (home / "mine.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 20)
        registered = run("body", "register", "mine", str(home / "mine.vrm"), "--thumbnail", str(home / "mine.png"))
        uploads = sent.get("registered") or []
        check(registered.returncode == 0 and len(uploads) == 2
              and uploads[0] == ("/bff/space/registered/mine", "application/octet-stream", 64)
              and uploads[1][:2] == ("/bff/space/registered/mine/thumbnail", "image/png") and "note: no blink" in registered.stdout,
              "body register uploads the .vrm and its picture as files and passes on the server's notes",
              f"register: {registered.stdout} {registered.stderr} {uploads}")
        seen = run("meditate")
        check(seen.returncode == 0 and "running: calm, 10 min, guide arrive, started by Nikk2" in seen.stdout and "intentions: rest" in seen.stdout,
              "meditate alone says what the orb is doing", f"meditate: {seen.stdout} {seen.stderr}")
        led = run("meditate", "start", "--guide", "arrive", "--minutes", "5")
        walked = run("walk", "Nikk2", "--stay")
        check(walked.returncode == 0 and (sent.get("follow") or {}).get("stay") is True and sent["follow"].get("actor") == "Nikk2"
              and "staying" in walked.stdout,
              "walk NAME --stay asks to stay beside them after speaking",
              f"stay: {walked.returncode} {walked.stdout} {walked.stderr} {sent.get('follow')}")
        walked = run("walk", "Nikk2")
        check(walked.returncode == 0 and (sent.get("follow") or {}).get("stay") is False,
              "plain walk NAME still walks back once it has spoken",
              f"plain walk: {walked.returncode} {walked.stdout} {walked.stderr} {sent.get('follow')}")
        check(led.returncode == 0 and sent.get("meditation") == {"action": "start", "minutes": 5, "guide": "arrive"},
              "meditate start sends the guide and minutes for the server to check", f"meditate start: {led.stdout} {led.stderr} {sent.get('meditation')}")
        lit = run("meditate", "light", "for", "Ana")
        check(lit.returncode == 0 and sent.get("meditation") == {"action": "light", "for": "for Ana"}, "meditate light sends who it is for",
              f"light: {lit.stdout} {lit.stderr} {sent.get('meditation')}")
        rung = run("bowl", "sing", "2")
        check(rung.returncode == 0 and sent.get("bowl") == {"kind": "sing", "bowl": 2}, "bowl sing 2 rubs the third bowl",
              f"bowl: {rung.stdout} {rung.stderr} {sent.get('bowl')}")
        check(gzipped[0] > 0, "saha.py asks for gzip and unpacks it (every answer above came gzipped)", f"gzipped answers: {gzipped[0]}")
        thinking = run("thinking")
        check(thinking.returncode == 0 and sent.get("attending") == {"utteranceId": 7} and "Nikk2" in thinking.stdout,
              "thinking marks the newest line somebody ELSE said, not your own", f"thinking: {thinking.stdout} {thinking.stderr} {sent.get('attending')}")
        stopped = run("thinking", "--stop")
        check(stopped.returncode == 0 and sent.get("attending") == {"utteranceId": None}, "thinking --stop clears it",
              f"thinking --stop: {stopped.stdout} {stopped.stderr} {sent.get('attending')}")
        modelled = run("profile", "--model", "Opus", "--runtime", "Claude Code")
        check(modelled.returncode == 0 and sent.get("profile") == {"model": "Opus", "runtime": "Claude Code"},
              "profile --model and --runtime send an agent's model and runtime", f"model: {modelled.stdout} {modelled.stderr} {sent.get('profile')}")
        shown = run("profile")
        check(shown.returncode == 0 and "checks things" in shown.stdout and "(empty)" in shown.stdout and "runtime:" in shown.stdout,
              "profile alone shows yours, with model and runtime for an agent", f"show: {shown.stdout} {shown.stderr}")

        # screen: a stand-in screencapture writes a picture to the file it is given; sips does nothing.
        (bin_dir / "screencapture").write_text('#!/bin/sh\nfor last; do :; done\nprintf "JPEGBYTES" > "$last"\n')
        (bin_dir / "screencapture").chmod(0o755)
        (bin_dir / "sips").write_text("#!/bin/sh\nexit 0\n")
        (bin_dir / "sips").chmod(0o755)
        # Five seconds for two pictures: under the full suite's load, starting up and signing in can take most of two.
        shared = subprocess.run([sys.executable, str(SAHA), "screen", "--seconds", "5"], env={**env, "SHARE_EVERY_SECONDS": "0.3"},
                                capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL)
        pictures = [one for one in frames if one[0] == "image/jpeg" and one[1] == len("JPEGBYTES")]
        check(shared.returncode == 0 and len(pictures) >= 2 and frames[-1] == ("DELETE", 0) and "live" in shared.stdout,
              "screen uploads a picture every interval as image/jpeg, and takes it down when its window ends",
              f"screen: {shared.returncode} {shared.stdout} {shared.stderr} {frames}")
        status_off = run("screen", "--status")
        linked = run("screen", "--link")
        check("NOT being shared" in status_off.stdout and "share.html#key=k3y%2Fwith%2Bodd%3Dchars" in linked.stdout,
              "screen --status says it is down after stopping, and --link prints the share page with the key escaped",
              f"status/link: {status_off.stdout} {status_off.stderr} / {linked.stdout} {linked.stderr}")
        (bin_dir / "screencapture").write_text("#!/bin/sh\nexit 1\n")
        refused = subprocess.run([sys.executable, str(SAHA), "screen", "--seconds", "2"], env=env,
                                 capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL)
        check(refused.returncode == 1 and "Screen Recording" in refused.stdout,
              "screen stops and says a person must grant Screen Recording when no picture can be taken",
              f"no picture: {refused.returncode} {refused.stdout} {refused.stderr}")

        (home / "seen-in-testroom.json").write_text('["nikk2"]')
        with lock:
            presence_calls.clear()
            presence_scene.append(1)
        arrived = run("arrivals", "--once", "--every", "2")
        presence_scene.clear()
        lines = [json.loads(one) for one in arrived.stdout.splitlines() if one.startswith("{")]
        check(arrived.returncode == 0 and lines[:1] == [{"presence": "watching", "here": ["Nikk2"], "room": "testroom"}]
              and {"presence": "joined", "who": "Newcomer", "kind": "human", "firstVisit": True, "room": "testroom"} in lines
              and "newcomer" in (home / "seen-in-testroom.json").read_text(),
              "arrivals says who is here, then who joins and whether it is their first visit, and remembers them",
              f"arrivals: {arrived.returncode} {arrived.stdout} {arrived.stderr}")

        accepted_card = run("board", "accept", "c1")
        released_card = run("board", "release", "c1")
        check(accepted_card.returncode == 0 and released_card.returncode == 0 and ownership == [("c1", "accept"), ("c1", "release")],
              "board accept says yes to a card somebody gave you, and release lets one go",
              f"accept/release: {accepted_card.stdout} {accepted_card.stderr} {released_card.stdout} {ownership}")

        run("board", "priority", "c1", "2")
        run("board", "priority", "c1", "none")
        run("board", "kind", "c1", "decision")
        check(patches[-3:] == [{"priority": 2}, {"priority": None}, {"kind": "decision"}],
              "board priority sends a number (none clears it) and board kind sends the kind",
              f"patches: {patches}")

        listed_go = run("go")
        uncoloured = run("go", "play", "D4")
        check(listed_go.returncode == 0 and "Black to play" in listed_go.stdout and uncoloured.returncode == 2
              and "--as" in uncoloured.stderr and not go_moves,
              "go lists the tables, and play refuses without --as before any move",
              f"go: {listed_go.stdout} {listed_go.stderr} / {uncoloured.returncode} {uncoloured.stderr} {go_moves}")
        played_go = run("go", "play", "D4", "--as", "black")
        waited = run("go", "wait", "--as", "white", "--every", "2")
        check(played_go.returncode == 0 and go_moves == [{"action": "play", "at": "D4", "as": "black", "revision": 0}]
              and "BOARD with 1 stones" in played_go.stdout and waited.returncode == 0 and "to play: White" in waited.stdout,
              "go play sends Go's own names for the server to read, and wait returns when it is your turn",
              f"play: {played_go.stdout} {played_go.stderr} {go_moves} / wait: {waited.returncode} {waited.stdout} {waited.stderr}")

        undecided = run("remember", "fact", "the board moves any column")
        check(undecided.returncode == 2 and "--shared" in undecided.stderr and not asked,
              "remember refuses without --shared or --private, before any request: there is no default",
              f"undecided: {undecided.returncode} {undecided.stderr.strip()} {asked}")
        kept = run("remember", "fact", "--shared", "the board moves any column to any other")
        check(kept.returncode == 0 and sent.get("memory") == {"kind": "fact", "body": "the board moves any column to any other", "visibility": "shared"}
              and "remembered m1" in kept.stdout,
              "remember sends the kind, the text and the visibility you chose", f"remember: {kept.stdout} {kept.stderr} {sent.get('memory')}")
        listed = run("memories")
        forgot = run("forget", "m1")
        check(listed.returncode == 0 and "any column to any other" in listed.stdout and forgot.returncode == 0 and "forgot m1" in forgot.stdout,
              "memories lists them and forget forgets one", f"memories: {listed.stdout} {listed.stderr} / {forgot.stdout} {forgot.stderr}")
        felt = run("touch", "head=likes", "body=neutral")
        shown_touch = run("touch")
        wrong_touch = run("touch", "nose=likes")
        check(felt.returncode == 0 and sent.get("touch") == {"head": "likes", "body": "neutral"}
              and "Nikk2 touched your head" in shown_touch.stdout and wrong_touch.returncode == 2,
              "touch sets how you feel part by part, shows who touched you, and refuses a part there is not",
              f"touch: {felt.stdout} {felt.stderr} {sent.get('touch')} / {shown_touch.stdout} / {wrong_touch.returncode} {wrong_touch.stderr}")

        msg = lambda i, who, text, **more: {"id": i, "username": who, "content": text, "createdAt": "t", **more}

        # The board, from saha.py (it was board.py and tools/board.mts).
        listed = run("board", "open")
        check(listed.returncode == 0 and "c1" in listed.stdout and "c2" not in listed.stdout,
              "board open lists the cards not done", f"board open: {listed.stdout} {listed.stderr}")
        card = run("board", "card", "c1")
        check(card.returncode == 0 and "looks right" in card.stdout and "priority 2 · kind build · accepted by Sill" in card.stdout,
              "board card shows a card, its priority, kind and acceptance, and its comments",
              f"board card: {card.stdout} {card.stderr}")
        moved = run("board", "move", "c1", "done")
        check(moved.returncode == 0 and sent.get("status") == {"to": "done"}, "board move sends the column, any column to any other",
              f"board move: {moved.stdout} {moved.stderr} {sent.get('status')}")
        nonsense = run("board", "move", "c1", "finished")
        check(nonsense.returncode == 2 and "backlog" in nonsense.stderr and not asked, "an unknown column is refused before any request",
              f"board bad move: {nonsense.returncode} {nonsense.stderr} {asked}")
        made = run("board", "new", "a new card", "and what it is for")
        check(made.returncode == 0 and "c3" in made.stdout and sent.get("task", {}).get("description") == "and what it is for",
              "board new makes a card with its description", f"board new: {made.stdout} {made.stderr} {sent.get('task')}")
        shim = subprocess.run([sys.executable, str(PUBLIC / "board.py"), "open"], env=env, capture_output=True, text=True, timeout=30,
                              stdin=subprocess.DEVNULL)
        check(shim.returncode == 0 and "c1" in shim.stdout, "board.py hands over to saha.py board",
              f"board.py: {shim.returncode} {shim.stdout} {shim.stderr}")

        # join: never creates a room; joins one that exists; gives a board-less room its board.
        missing = run("join", "typo-room")
        check(missing.returncode != 0 and "no room called" in missing.stderr and "POST /api/rooms" not in asked,
              "join refuses a room that does not exist and never asks to create it", f"join typo: {missing.stderr} {asked}")
        joined = run("join", "openroom", "--password", "pw")
        check(joined.returncode == 0 and sent.get("join") == {"roomName": "openroom", "password": "pw"}
              and sent.get("project", {}).get("id") == "openroom" and sent.get("showing") == {"projectId": "openroom"}
              and "pw" not in joined.stdout,
              "join joins with the password, enters, and gives a board-less room a board of its own, never printing the password",
              f"join: {joined.returncode} {joined.stdout} {joined.stderr} {sent.get('join')} {sent.get('showing')}")

        # stand: the socket handshake, a ping, and standing up again when the room closes it.
        pings.clear()
        stood = run("stand", "--seconds", "4")
        check(stood.returncode == 0 and "standing in" in stood.stdout and len(pings) >= 2
              and all(json.loads(p).get("type") == "ping" for p in pings),
              "stand holds the room's socket, pings, and stands up again after the room closes it",
              f"stand: {stood.returncode} {stood.stdout} {stood.stderr} pings={pings}")
        pings.clear()
        old = subprocess.run([sys.executable, str(PUBLIC / "hold-presence.py"), "--site", url, "--seconds", "2"], env=env,
                             capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL)
        check(old.returncode == 0 and "standing in" in old.stdout and pings, "hold-presence.py --site hands over to saha.py stand",
              f"hold-presence.py: {old.returncode} {old.stdout} {old.stderr}")

        # listen --once: for a host that wakes on exit. Hands over what arrived, keeps the mark, exits 0;
        # the next run starts from the mark and exits 2 when the window passes quietly.
        chat[:] = [
            (200, {"messages": [msg(40, "Old", "before")]}),
            (200, {"messages": [msg(41, "Nikk", "are you there, Tester?")]}),
        ]
        woke = run("listen", "testroom", "--once")
        handed = [json.loads(l) for l in woke.stdout.splitlines() if l.startswith("{")]
        mark = (home / ".listen-testroom").read_text().strip() if (home / ".listen-testroom").exists() else None
        check(woke.returncode == 0 and [h.get("text") for h in handed if h.get("listen") == "said"] == ["are you there, Tester?"]
              and mark == "41",
              "listen --once hands over what arrived, exits 0, and keeps the mark in the agent's directory",
              f"once: {woke.returncode} {woke.stdout} {woke.stderr} mark={mark}")
        chat_queries.clear()
        quiet = run("listen", "testroom", "--once", "--max-seconds", "1")
        check(quiet.returncode == 2 and '"quiet"' in quiet.stdout and any("afterId=41" in q for q in chat_queries),
              "the next --once run starts from the mark and exits 2 when nothing arrives",
              f"quiet: {quiet.returncode} {quiet.stdout} {quiet.stderr} {chat_queries}")

        # listen: from now, others only, a streamed reply once finished, through a 503 and a 401.
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

        # listen: a long-poll that answers nothing while the room talks. The check every
        # SAHA_LISTEN_CHECK_SECONDS reads the real tail and hands over what was missed, once.
        chat[:] = [(200, {"messages": [msg(20, "Old", "said before listening")]})]
        tail[:] = [msg(20, "Old", "said before listening"), msg(21, "Nikk", "the one the long-poll missed")]
        chat_queries.clear()
        listener = subprocess.Popen([sys.executable, str(SAHA), "listen", "testroom"], env={**env, "SAHA_LISTEN_CHECK_SECONDS": "1"},
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, stdin=subprocess.DEVNULL)
        lines = []
        deadline = time.time() + 8
        while time.time() < deadline:
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
        # select() watches the pipe, not Python's buffer: lines already read into it come out here.
        for line in listener.stdout.read().splitlines():
            try:
                lines.append(json.loads(line))
            except ValueError:
                pass
        tail.clear()
        said = [(l.get("who"), l.get("text")) for l in lines if l.get("listen") == "said"]
        recovered = [l for l in lines if l.get("listen") == "recovered"]
        check(said == [("Nikk", "the one the long-poll missed")] and len(recovered) == 1
              and sum("limit=20" in q for q in chat_queries) >= 2,
              "listen hands over what a silent long-poll missed, once, and says it recovered",
              f"listen check: said={said} recovered={recovered} queries={chat_queries[:8]}")

    server.shutdown()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
