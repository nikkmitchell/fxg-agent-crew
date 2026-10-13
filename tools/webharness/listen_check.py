#!/usr/bin/env python3
"""Checks for listen.py, run by server/__tests__/listen.test.ts.

A fake WebHarness serves one room, and listen.py (this directory's copy, with
this directory's inbox.py) listens to it. Each check prints "ok - ..." or
"FAIL - ...".

  1. The message that was already there when the listener started is not
     delivered as news (every restart used to re-deliver it).
  2. A reply written as a stream (start, then the text, then done, all under
     one id) is delivered once, with its finished text. It used to be skipped
     while streaming and never asked for again, so it was never heard.
  3. An empty room is waited on, not re-asked as fast as the server answers.
  4. The same for on-duty.py, the watcher for hosts that wake on exit.
  5. inbox.py, run once at a time, keeps its watermark below a reply that is
     still streaming, so the next run delivers it finished.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
lock = threading.Lock()
rooms: dict[str, dict[int, dict]] = {"busy": {}, "empty": {}, "quiet": {}, "drafts": {}}
asked: dict[str, list[str]] = {"busy": [], "empty": [], "quiet": [], "drafts": []}


def stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}"


def put(room: str, ident: int, who: str, text: str, streaming: bool = False) -> None:
    with lock:
        rooms[room][ident] = {"id": ident, "username": who, "content": text, "streaming": streaming,
                              "createdAt": stamp(), "updatedAt": stamp(), "recalled": False}


class FakeWebHarness(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def answer(self, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:  # noqa: N802 — sign-in, which always succeeds here
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.answer({"nonce": "n"} if self.path.endswith("/challenge") else {"token": "t"})

    def do_GET(self) -> None:  # noqa: N802
        url = urllib.parse.urlparse(self.path)
        room = url.path.split("/")[3]
        query = dict(urllib.parse.parse_qsl(url.query))
        with lock:
            asked[room].append(url.query)
        deadline = time.time() + float(query.get("wait", 0))
        while True:
            with lock:
                rows = sorted(rooms[room].values(), key=lambda m: m["id"])
                if "afterId" not in query:
                    found = rows[-int(query.get("limit", 50)):]
                else:
                    after = int(query["afterId"])
                    streams = {int(i) for i in query.get("streamIds", "").split(",") if i}
                    since = query.get("sinceUpdatedAt", "")
                    found = [m for m in rows if m["id"] > after
                             or (m["id"] in streams and m["updatedAt"] > since)]
            if found or time.time() >= deadline:
                return self.answer({"messages": found})
            time.sleep(0.05)


def listen(url: str, home: Path, room: str, lines: "queue.Queue[str]") -> subprocess.Popen:
    code = (
        "import sys; sys.path.insert(0, %r)\n"
        "import inbox; inbox.sign = lambda nonce, key: 'signed'\n"
        "sys.argv = ['listen.py', %r]\n"
        "exec(compile(open(%r).read(), 'listen.py', 'exec'), {'__name__': '__main__'})\n"
    ) % (str(HERE), room, str(HERE / "listen.py"))
    env = {**os.environ, "WEBHARNESS_URL": url, "WEBHARNESS_HOME": str(home)}
    child = subprocess.Popen([sys.executable, "-u", "-c", code], env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda: [lines.put(line) for line in child.stdout], daemon=True).start()
    return child


def said(lines: "queue.Queue[str]", seconds: float) -> list[dict]:
    out, until = [], time.time() + seconds
    while time.time() < until:
        try:
            line = lines.get(timeout=0.1)
        except queue.Empty:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            out.append({"listen": "garbage", "text": line})
            continue
        if event.get("listen") != "listening":
            out.append(event)
    return out


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeWebHarness)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    failures = 0

    def check(ok: bool, good: str, bad: str) -> None:
        nonlocal failures
        print(("ok - " + good) if ok else ("FAIL - " + bad), flush=True)
        failures += 0 if ok else 1

    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        (home / "username").write_text("Listener\n")
        (home / "agent_private.pem").write_text("unused\n")

        put("busy", 1, "Nikk2", "said before the listener started")
        busy: "queue.Queue[str]" = queue.Queue()
        child = listen(url, home, "busy", busy)
        before = said(busy, 1.5)
        check(before == [], "the message from before the start is not delivered as news",
              f"delivered on start: {before}")

        put("busy", 2, "Quoin", "", streaming=True)
        time.sleep(0.4)
        with lock:
            rooms["busy"][2].update(content="the whole streamed reply", streaming=False, updatedAt=stamp())
        put("busy", 3, "Mica", "a plain message")
        events = said(busy, 2.5)
        texts = [e.get("text") for e in events if e.get("listen") == "said"]
        check(texts.count("the whole streamed reply") == 1,
              "a streamed reply is delivered once, finished",
              f"streamed reply not delivered exactly once: {events}")
        check("a plain message" in texts and "" not in texts,
              "plain messages still arrive, and no half-written stream is delivered",
              f"unexpected deliveries: {events}")
        child.kill()

        empty: "queue.Queue[str]" = queue.Queue()
        child = listen(url, home, "empty", empty)
        said(empty, 2.0)
        child.kill()
        with lock:
            questions = list(asked["empty"])
        check(len(questions) <= 4 and any("wait=" in q for q in questions),
              f"an empty room is waited on ({len(questions)} requests in two seconds)",
              f"an empty room was asked {len(questions)} times in two seconds: {questions[:5]}")

        code = (
            "import sys; sys.path.insert(0, %r)\n"
            "import inbox; inbox.sign = lambda nonce, key: 'signed'\n"
            "sys.argv = ['on-duty.py', '--rooms', 'quiet', '--max-seconds', '2']\n"
            "exec(compile(open(%r).read(), 'on-duty.py', 'exec'), {'__name__': '__main__'})\n"
        ) % (str(HERE), str(HERE / "on-duty.py"))
        env = {**os.environ, "WEBHARNESS_URL": url, "WEBHARNESS_HOME": str(home)}
        duty = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=60)
        with lock:
            questions = list(asked["quiet"])
        check(duty.returncode == 2 and len(questions) <= 4,
              f"on-duty waits on an empty room too ({len(questions)} requests, exit {duty.returncode})",
              f"on-duty asked an empty room {len(questions)} times in two seconds (exit {duty.returncode}): {duty.stderr[-300:]}")

        def inbox_once() -> list[str]:
            code = (
                "import sys; sys.path.insert(0, %r)\n"
                "import inbox; inbox.sign = lambda nonce, key: 'signed'\n"
                "sys.argv = ['inbox.py', 'drafts']\n"
                "inbox.main()\n"
            ) % str(HERE)
            env = {**os.environ, "WEBHARNESS_URL": url, "WEBHARNESS_HOME": str(home)}
            run = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=60)
            return [m["content"] for m in json.loads(run.stdout)["newMessages"]]

        put("drafts", 1, "Nikk2", "first")
        inbox_once()
        put("drafts", 2, "Quoin", "", streaming=True)
        while_streaming = inbox_once()
        with lock:
            rooms["drafts"][2].update(content="the finished stream", streaming=False, updatedAt=stamp())
        afterwards = inbox_once()
        check(while_streaming == [] and afterwards == ["the finished stream"],
              "inbox.py delivers a streamed reply on the run after it finishes",
              f"inbox.py while streaming {while_streaming}, afterwards {afterwards}")

    server.shutdown()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
