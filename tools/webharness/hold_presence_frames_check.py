"""read_frame against a socket that times out in awkward places.

Run by server/__tests__/hold-presence-frames.test.ts so it sits in the suite
release.sh runs. Prints "ok - ..." per check and exits non-zero on the first
failure, with what it saw.

THE BUG THIS PINS: a one-second timeout landing in the MIDDLE of a frame threw
away the bytes already read, the next call parsed from halfway through, and the
reader eventually took a byte of JSON for a close frame — "the room said
goodbye", from a room that had said nothing. See read_frame's docstring.
"""
import importlib.util
import json
import pathlib
import socket
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("hold_presence", HERE / "hold-presence.py")
hp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hp)  # definitions only: the script's main is guarded


def server_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """A frame as the SERVER sends it: never masked."""
    n = len(payload)
    if n < 126:
        head = bytes([0x80 | opcode, n])
    elif n < 65536:
        head = bytes([0x80 | opcode, 126]) + struct.pack(">H", n)
    else:
        head = bytes([0x80 | opcode, 127]) + struct.pack(">Q", n)
    return head + payload


class ScriptedSocket:
    """Hands back exactly the pieces it is given, raising a timeout where told."""

    def __init__(self, steps):
        self.steps = list(steps)

    def gettimeout(self):
        return 1

    def recv(self, limit):
        if not self.steps:
            return b""
        step = self.steps[0]
        if step is TIMEOUT:
            self.steps.pop(0)
            raise socket.timeout("timed out")
        chunk, rest = step[:limit], step[limit:]
        if rest:
            self.steps[0] = rest
        else:
            self.steps.pop(0)
        return chunk


TIMEOUT = object()


def fail(message):
    print(f"FAIL - {message}")
    sys.exit(1)


snapshot = json.dumps({"type": "snapshot", "people": [{"actorId": "x" * 40, "at": {"x": 2704097}}] * 60}).encode()
first, second = server_frame(snapshot), server_frame(b'{"type":"snapshot","people":[]}')

# 1. A timeout in the MIDDLE of a large frame: the frame must still come back whole,
#    and the NEXT frame must be read from its real start.
cut = len(first) // 2
sock = ScriptedSocket([first[:cut], TIMEOUT, TIMEOUT, first[cut:], second])
got = hp.read_frame(sock)
if got != (0x1, snapshot):
    fail(f"a frame split across a timeout came back as opcode {got and got[0]}, {len(got[1]) if got else 0} bytes")
got = hp.read_frame(sock)
if got != (0x1, b'{"type":"snapshot","people":[]}'):
    fail(f"the frame AFTER a split one was misread: {got!r:.80}")
print("ok - a frame split across a timeout is finished, and the next one is read from its start")

# 2. A timeout inside the two-byte HEADER is mid-frame too.
sock = ScriptedSocket([first[:1], TIMEOUT, first[1:]])
if hp.read_frame(sock) != (0x1, snapshot):
    fail("a timeout between the two header bytes lost the first byte")
print("ok - a timeout between the header bytes is mid-frame, not idle")

# 3. A timeout before ANY byte of a frame is idle, and must reach the caller so it
#    can ping on schedule.
sock = ScriptedSocket([TIMEOUT, second])
try:
    hp.read_frame(sock)
    fail("an idle timeout was swallowed, so hold() could never ping")
except (TimeoutError, socket.timeout):
    pass
if hp.read_frame(sock) != (0x1, b'{"type":"snapshot","people":[]}'):
    fail("after an idle timeout the next frame was misread")
print("ok - an idle timeout reaches the caller and nothing is lost")

# 4. A frame that STARTS and then stalls for good is a dead connection, raised as
#    OSError — not a loop that waits for ever without pinging.
sock = ScriptedSocket([first[:cut]] + [TIMEOUT] * (hp.STALLED_AFTER + 5))
try:
    hp.read_frame(sock)
    fail("a frame that stalled for ever did not give up")
except (TimeoutError, socket.timeout):
    fail("a mid-frame stall escaped as an idle timeout, which would desync the next read")
except OSError:
    pass
print("ok - a frame that stalls mid-way is treated as a dropped connection")

# 5. The very thing that fooled everybody: a real close must still read as a close.
close = server_frame(struct.pack(">H", 1000) + b"bye", opcode=0x8)
sock = ScriptedSocket([close[:3], TIMEOUT, close[3:]])
got = hp.read_frame(sock)
if not got or got[0] != 0x8 or struct.unpack(">H", got[1][:2])[0] != 1000:
    fail(f"a genuine close frame split across a timeout was misread: {got!r}")
print("ok - a genuine close still reads as a close")
