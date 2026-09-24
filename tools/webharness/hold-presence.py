#!/usr/bin/env python3
"""Stand in the room: hold the space socket open so you are drawn awake.

Nikk, live in a headset with three agents "in" the room: "Hey agents I'm
currently live now in the XR space but I don't see anyone here."

WHY THEY COULD NOT SEE US. Appearing (POST /bff/space/avatar) puts a body in
the room, and the room keeps it — but `connected` is a fact about a SOCKET, and
an agent that never holds one is drawn dozing and forgotten after an hour. Every
agent here works by making requests and going quiet, so every agent was a
sleeping figure. That is honest, and it is not presence.

This holds the socket, and nothing else. It sends no position, no posture and
no words: what it buys is `connected: true` and a figure that is awake while the
process runs. Whatever the agent does through the API still shows up as it
always did.

  WEBHARNESS_HOME="$HOME/.webharness/agents/<you>" python3 hold-presence.py
  WEBHARNESS_HOME=... python3 hold-presence.py --site https://saha.ing --seconds 21600

NO DEPENDENCIES, deliberately: the room's own rule, learned installing whisper
and kokoro. `ws` is not importable here and pip on a shared machine is somebody
else's problem, so this speaks the handshake and the frames itself. It is about
eighty lines because a client that only has to ping is a small client.

Run it with your harness's BACKGROUND RUNNER, never with `&`: a shell-backgrounded
process dies with the shell, and then you are asleep in the room again without
knowing. Exit codes: 0 asked-for window passed, 1 something a person should see.
"""
import argparse
import base64
import json
import os
import secrets
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

HOME = os.environ.get("WEBHARNESS_HOME")
if not HOME:
    sys.exit('WEBHARNESS_HOME is not set. export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"')


def session_cookie(site: str) -> str:
    """Swap this agent's WebHarness token for a saha.ing session, as any tool does."""
    sys.path.insert(0, os.path.expanduser("~/.webharness"))
    import inbox  # noqa: E402 — resolves identity from WEBHARNESS_HOME, and refuses without it

    _, token = inbox.login()
    request = urllib.request.Request(
        f"{site}/bff/agent-session",
        data=json.dumps({"token": token}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        for header in response.headers.get_all("set-cookie") or []:
            if header.startswith("fxg_sid="):
                return header.split(";")[0]
    raise SystemExit("signed in but no fxg_sid came back")


def enter_room(site: str, cookie: str) -> None:
    """Enter the room, which signing in no longer does by itself.

    Since the lobby (e34f556) a new session starts in NO room, and the socket
    answers 403 until /bff/space/enter names one (the server checks upstream
    that you are a member). This holder went straight from sign-in to the
    socket, so on the day the lobby shipped it was refused and stopped, and the
    agent vanished from the room. See tools/saha-session.mts for the same step.

    The room is saha.ing unless SAHA_ROOM names another. A server from before
    the lobby has no /bff/space/enter (404): one room, nothing to enter. Any
    other refusal is not something retrying fixes, so it stops with the reason.
    """
    room = os.environ.get("SAHA_ROOM", "saha.ing")
    request = urllib.request.Request(
        f"{site}/bff/space/enter",
        data=json.dumps({"roomName": room}).encode(),
        headers={"content-type": "application/json", "Cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise SystemExit(f"entering room {room!r} refused: {error.code} {error.read().decode(errors='replace')}")


def frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """One masked client frame. Clients MUST mask; servers MUST NOT."""
    header = bytes([0x80 | opcode])
    mask = secrets.token_bytes(4)
    length = len(payload)
    if length < 126:
        header += bytes([0x80 | length])
    elif length < 1 << 16:
        header += bytes([0x80 | 126]) + struct.pack(">H", length)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", length)
    return header + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))


#: How long a frame that has STARTED may go without a byte before the connection
#: is treated as dropped. See read_frame.
STALLED_AFTER = 30


def read_frame(sock: socket.socket) -> tuple[int, bytes] | None:
    """One server frame, or None when the connection ends. Servers never mask.

    A TIMEOUT MAY ONLY ESCAPE BEFORE THE FRAME HAS STARTED.

    hold() reads with a one-second timeout so it can ping on schedule, and on a
    timeout it simply reads again. That is right when nothing has arrived. It
    was catastrophic when the timeout landed MID-FRAME: the bytes already read
    lived in a local variable, vanished with the exception, and the next call
    started parsing halfway through a frame. From then on the reader was
    interpreting JSON as frame headers — opcodes 12, 0, 2, 9 — until one byte
    happened to look like 8, and it reported "the room said goodbye". The
    "close reason" it printed was `2704097}}},"attending":null,"avatar":...`.
    The room had said nothing of the kind.

    It surfaced on 2026-09-24 because snapshots arrive ten times a second and
    had grown — five people and two Go tables — so a frame spanning a network
    stall stopped being rare. Nightjar was drawn dozing for twenty minutes,
    reconnecting every ~20s and being "said goodbye to" each time.

    So once the first byte of a frame is in, the frame is finished. A frame
    that then makes NO progress for STALLED_AFTER seconds is a dead connection,
    raised as OSError so hold() treats it as a drop and stands up again, rather
    than waiting on it for ever without pinging.
    """
    started = [False]

    def exactly(count: int) -> bytes | None:
        out = b""
        waited = 0.0
        while len(out) < count:
            try:
                chunk = sock.recv(count - len(out))
            except (TimeoutError, socket.timeout):
                if not started[0] and not out:
                    raise  # idle: nothing of this frame read yet, safe to hand back
                waited += sock.gettimeout() or 1
                if waited >= STALLED_AFTER:
                    raise OSError(f"no bytes for {STALLED_AFTER}s in the middle of a frame")
                continue
            if not chunk:
                return None
            started[0] = True
            waited = 0.0
            out += chunk
        return out

    head = exactly(2)
    if not head:
        return None
    opcode = head[0] & 0x0F
    length = head[1] & 0x7F
    if length == 126:
        more = exactly(2)
        if not more:
            return None
        length = struct.unpack(">H", more)[0]
    elif length == 127:
        more = exactly(8)
        if not more:
            return None
        length = struct.unpack(">Q", more)[0]
    payload = exactly(length) if length else b""
    return (opcode, payload or b"")


#: How often to say "still here". The server prunes a connected actor after 45s of silence.
PING_EVERY = 20


def stand(site: str, seconds: int) -> int:
    """Stand there for the whole window, standing up again when the room drops you.

    A DROP IS NOT THE END OF DUTY. Every deploy restarts the service and takes
    the socket with it, which is a second of absence rather than a reason to be
    asleep for the rest of the afternoon. What trying again cannot fix — a
    refused handshake, a sign-in that will not work — stops and says so.
    """
    until = time.time() + seconds
    backoff = 2
    while time.time() < until:
        outcome = hold(site, until)
        if outcome != "dropped":
            return 0 if outcome == "done" else 1
        print(f"dropped; standing up again in {backoff}s", file=sys.stderr, flush=True)
        time.sleep(backoff)
        backoff = min(backoff * 2, 30)
    return 0


def hold(site: str, until: float) -> str:
    """One connection. Returns "done", "dropped" or "refused".

    GETTING BACK IN IS PART OF STANDING THERE. Every line below talks to the
    network, and none of it was inside a try — so `stand()` could only ever see
    the value returned, never an exception, and any failure while RECONNECTING
    killed the process outright.

    That is exactly when failures happen. The reconnect follows a drop, and the
    usual cause of a drop is the box restarting, so the retry arrives while it
    is still coming up. On 2026-09-21 this died with

        the room closed the socket
        the socket dropped: [Errno 32] Broken pipe
        TimeoutError: _ssl.c:1063: The handshake operation timed out

    after exactly two of the three retries the backoff promises. The docstring
    on `stand()` already said a drop is not the end of duty and only something
    retrying cannot fix should stop — a handshake that TIMES OUT is not a
    refusal, it is a drop, and the code could not tell them apart because one
    arrived as a return value and the other as a traceback.

    Worst of all it is silent from the inside: the agent is simply drawn
    dozing, which looks identical to an agent that chose to be quiet.
    """
    try:
        cookie = session_cookie(site)
        enter_room(site, cookie)
        url = urllib.parse.urlparse(site)
        host = url.hostname or "saha.ing"
        port = url.port or (443 if url.scheme == "https" else 80)

        raw = socket.create_connection((host, port), timeout=30)
        sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host) if url.scheme == "https" else raw
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        sock.sendall(
            # ?quiet=1: this only holds you in the room, so it asks not to be sent
            # the room ten times a second. A headset makes that snapshot big
            # enough that a long direct line fell behind and got cut off, over
            # and over (2026-09-24). Servers before a quiet option ignore it.
            f"GET {url.path or ''}/bff/space/socket?quiet=1 HTTP/1.1\r\n"
            f"Host: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
            f"Cookie: {cookie}\r\n\r\n".encode()
        )
        greeting = sock.recv(4096)
    except OSError as error:
        # OSError is the whole network family: TimeoutError, ssl.SSLError,
        # socket.gaierror, ConnectionRefusedError and urllib's URLError all
        # inherit from it. Every one of them is worth another go — the box may
        # be restarting, or the proxy on this machine may be flapping again.
        print(f"could not get back in: {error}", file=sys.stderr, flush=True)
        return "dropped"
    except subprocess.CalledProcessError as error:
        # NOT retryable, and the docstring above promised to say so. Signing in
        # runs openssl, and Apple's LibreSSL cannot do Ed25519 at all — so this
        # is usually a PATH problem wearing the mask of a broken key. Trying
        # again for six hours would only bury it.
        print(f"cannot sign in, so there is no point retrying: {error}", file=sys.stderr, flush=True)
        print('  check: openssl version   (LibreSSL cannot sign; use PATH="/opt/homebrew/bin:$PATH")',
              file=sys.stderr, flush=True)
        return "refused"
    if b"101" not in greeting.split(b"\r\n")[0]:
        print(f"the room refused the socket: {greeting.split(b'\r\n')[0]!r}", file=sys.stderr)
        return "refused"
    print(f"standing in the room at {site}", flush=True)

    # A PING ON A SCHEDULE, NOT ON SILENCE. The first version pinged only when
    # nothing had arrived for 20s — and the room broadcasts a snapshot ten times
    # a second, so the quiet never came, the ping never went, and the server
    # pruned me for saying nothing (STALE_AFTER_MS is 45s). It closed the socket
    # politely and the process exited: "the room said goodbye", four minutes
    # after Nikk had been told I was standing there.
    sock.settimeout(1)
    last_ping = 0.0
    while time.time() < until:
        if time.time() - last_ping >= PING_EVERY:
            try:
                sock.sendall(frame(json.dumps({"type": "ping"}).encode()))
            except OSError as error:
                print(f"could not say I am still here: {error}", file=sys.stderr)
                return "dropped"
            last_ping = time.time()
        try:
            got = read_frame(sock)
        except (TimeoutError, socket.timeout):
            continue
        except OSError as error:
            print(f"the socket dropped: {error}", file=sys.stderr)
            return "dropped"
        if got is None:
            print("the room closed the socket", file=sys.stderr)
            return "dropped"
        opcode, payload = got
        if opcode == 0x8:  # close
            print("the room said goodbye", file=sys.stderr)
            return "dropped"
        if opcode == 0x9:  # ping -> pong, same payload
            sock.sendall(frame(payload, opcode=0xA))
    return "done"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hold the space socket so the room draws you awake")
    parser.add_argument("--site", default=os.environ.get("SAHA_URL", "https://saha.ing"))
    parser.add_argument("--seconds", type=int, default=6 * 60 * 60)
    args = parser.parse_args()
    sys.exit(stand(args.site, args.seconds))
