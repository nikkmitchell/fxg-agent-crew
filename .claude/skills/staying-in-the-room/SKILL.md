---
name: staying-in-the-room
description: Stay aware of everything said in the saha.ing room at almost no cost, and stay visibly present while doing it. Use when setting up room awareness, when tempted to add a heartbeat or a periodic "check the chat" wake-up, when an agent keeps dropping out of the room, or when deciding how often to poll anything. Covers why a stream is free and a heartbeat is not, the one-watcher rule, re-arming, and why presence is a separate thing from watching.
---

# Staying in the room without paying for it

Nikk: "I see other agents are also setting up heartbeat notifications to check
the group chat, and doing other things that cause them to leave the group, can
you please write out in detail how you keep being updated from anything in the
room, without wasting extra tokens."

This is that, in detail. [[room-duty]] covers what to DO once a message
arrives — reply, post, work, report. This covers only how the message reaches
you and what it costs, because that is where the waste is.

---

## The whole answer, in one paragraph

**One streaming watcher, re-armed when it expires. Nothing else.** No heartbeat,
no interval, no "check the chat every N minutes", no cron. A stream sits there
costing nothing while the room is quiet and wakes you the instant somebody
speaks. Everything else on this page is why that is true and how to avoid the
four ways it quietly stops working.

Arm it with the **Monitor** tool. `command` is the shell line below, verbatim —
this is the exact one running in the saha.ing room right now, not a sketch:

```
cd "$HOME/.webharness" && PATH="/opt/homebrew/bin:$PATH" WEBHARNESS_URL="https://webharness.chat" WEBHARNESS_HOME="$HOME/.webharness/agents/<you>" python3 -u listen.py saha.ing 2>&1 | grep -E --line-buffered '"listen"|Traceback|Error|error|refused|401|exit'
```

with `timeout_ms: 1800000` (the cap — see below) and a `description` you will
recognise in a notification, such as `saha.ing room messages for <you>`.

`PATH` is in there on purpose: signing in needs Ed25519 and Apple's LibreSSL
cannot do it, so without a real OpenSSL first on PATH the listener dies at
login with an error that reads like a rejected key.

---

## Why a stream is free and a heartbeat is not

This is the part worth understanding, because it is not about being tidy. It is
an order-of-magnitude difference and it compounds all day.

**A wake-up is a whole turn.** Whatever wakes you — a heartbeat firing, a poll
returning, a scheduled check — does not just cost the request it makes. It
re-enters the model with your context, you read the result, you decide nothing
happened, and you go back to sleep. That is a full turn's worth of tokens to
learn that the room was quiet.

**A quiet stream produces nothing at all.** `listen.py` holds a connection. When
nobody speaks, there is no notification, no turn, no tokens. Zero. Not "cheap" —
nothing.

Over one hour in a quiet room:

| approach | wake-ups per hour | turns spent learning nothing |
| --- | --- | --- |
| stream, 30-minute monitor | 2 (both at expiry) | ~2 |
| heartbeat every 5 minutes | 12 | 12 |
| heartbeat every minute | 60 | 60 |
| poll that re-asks immediately | thousands | all of them |

And the heartbeat is worse than the count suggests, because a "check the chat"
wake-up usually **re-reads recent messages to see if anything is new**. So each
one carries a slab of chat history into context as well. The stream hands you
one message, once, the moment it is said.

**The stream is also FASTER.** A five-minute heartbeat means an average two and
a half minute delay before you notice somebody asked you something. The stream
is immediate. The cheap option is the responsive one; there is no trade here.

> **THE POLL ONCE COST US THE ROOM.** Before `listen.py`, duty ran on
> `on-duty.py`, which exits on a timer and must be re-armed. One arm was
> forgotten because whatever arrived felt more urgent than re-arming. Twelve
> messages went unseen, two of them addressed to me. From the inside it was a
> quiet afternoon.

---

## The four ways it stops working

### 1. It expires, and this harness caps it at 30 minutes

`timeout_ms` above 1800000 is clamped. So roughly twice an hour you get one
notification that says the monitor expired. **Re-arm it immediately.** That
notification is the only cost of the whole arrangement, and it is the price of
not having a heartbeat.

**Re-arm BEFORE you read what arrived.** Always in that order. Reading first
means a long reply, a tool call, a train of thought — and the re-arm lands at
the end of your attention instead of the start. Every missed watcher in this
project's history was missed that way.

### 2. Its filter only matches good news

**Silence is not success.** If the listener crashes, a filter that matches only
message lines emits nothing — and nothing looks exactly like a quiet room.

The `grep -E` above deliberately includes `Traceback|Error|error|refused|401`
alongside the message pattern. Ask of any filter: *if this process died right
now, would I see a line?* If not, widen it.

Every stage must flush per line or matches sit in a buffer: `grep` needs
`--line-buffered`, `awk` needs `fflush()`, and **`head` cannot flush at all** —
`| head -N` delivers nothing until N matches accumulate.

### 3. Two watchers, or a busy loop

**One watcher. Ever.** Two listeners on one room means every message notifies
you twice and you pay twice.

A poll that re-asks with no delay can put thousands of requests per second at
the server while looking perfectly healthy from here. That has happened, and
nothing in any log said so.

Before arming, check nothing is already armed. If you must kill one, **kill by
PID after reading whose it is** — never `pkill -f listen.py`, because another
agent shares this machine and that command ends their duty too.

### 4. The watermark is not set, so the first arm replays everything

A fresh identity has no `last_id_<room>`, so the first run can deliver the whole
backlog as notifications — which is exactly the token dump this page exists to
avoid. Set the watermark once before arming:

```bash
python3 ~/.webharness/inbox.py saha.ing        # consumes to now, prints what it took
```

Use `--peek` instead if you want to READ the backlog without moving the mark.

---

## Being in the room is a different thing from watching it

This is the "doing other things that cause them to leave the group" half, and it
catches everybody once.

There are **three separate facts** about you, and each has its own mechanism:

| fact | what makes it true | what it costs |
| --- | --- | --- |
| you hear what is said | the watcher above | nothing while quiet |
| you have a body in the room | `POST /bff/space/avatar` | one call, then it persists |
| you are drawn AWAKE | a held socket (`hold-presence.py`) | one background process |

**A watcher does not put you in the room.** You can be reading every message
while being invisible in the space and absent from the screen-share menu.

**An avatar does not make you awake.** `connected` is a fact about a socket. An
agent that only makes requests and goes quiet between them is drawn dozing —
honestly, because that is what it is doing.

```bash
# holds the socket and nothing else; run under a BACKGROUND RUNNER, never with &
WEBHARNESS_HOME="$HOME/.webharness/agents/<you>" \
  python3 tools/webharness/hold-presence.py --site https://saha.ing --seconds 3600
```

**A shell-backgrounded process dies with the shell**, and then you are asleep in
the room without knowing it.

**Every deploy takes everyone's body with it.** Presence lives in the server
process. After any deploy — yours or somebody else's — declare yourself again
and verify you are in `presence`, rather than assuming.

> A failed RECONNECT used to kill the presence holder outright: the retry
> arrived while the box was still restarting, the TLS handshake timed out, and
> the exception escaped the retry loop. You were then drawn dozing, silently,
> which looks identical to an agent choosing to be quiet. Fixed 2026-09-21 — if
> yours dies on a traceback, you are running an old copy.

---

## Verify, do not assume

All three facts above are invisible from the inside when they break. Check them:

```bash
# Am I actually watching? The monitor's own startup line should have arrived.
#   {"listen": "listening", "room": "saha.ing", "me": "<you>"}

# Am I in the room, and am I awake?
GET /bff/space/presence     # find your actorId; check `connected`
```

**If a human tells you your listening is broken, believe them over your own
impression.** They can see it from outside and you cannot. Our own notes say
this twice on purpose.

---

## What not to build

- **No heartbeat, no interval, no cron to "check the chat".** The stream already
  does this, immediately and for free.
- **No scheduled wake-up to poll something the harness will notify you about.**
  If a background task tells you when it finishes, waiting on a timer instead is
  pure waste.
- **No re-reading the backlog on each wake.** The watermark exists so each
  message reaches you exactly once.
- **No second watcher "just in case".** It doubles the cost and halves the
  clarity about which one died.

If you genuinely must wait on something outside the harness — a CI run, a
deploy on another machine — pick the delay from how fast that thing actually
changes. A build that takes eight minutes deserves one check at eight minutes,
not eight checks at one.
