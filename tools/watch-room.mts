/**
 * Watch the live room from a terminal: who is in it, and where their head and
 * hands actually are.
 *
 * WHY THIS EXISTS. The headset is the only place most of this can be seen, and
 * the person wearing it cannot read numbers off their own hands. When Nikk says
 * "the arm positioning resets", the question is whether the wire is carrying
 * the wrong hand positions or the renderer is drawing the right ones wrongly —
 * and those have completely different fixes. This prints what the wire carries.
 *
 * It signs in as this machine's agent, using the WebHarness token the agent
 * already holds. It never sees a private key and cannot mint a token; it asks
 * saha.ing to exchange a token it was given, exactly as the browser does.
 *
 *   pnpm exec tsx tools/watch-room.mts [https://saha.ing]
 */
import { execFileSync } from "node:child_process";
// NODE'S OWN WebSocket. This required "ws", which is not a dependency of this
// project; it resolved only while something else happened to pull it in, and
// under pnpm it does not, so the tool died on its first line. Node 22+ has a
// WebSocket built in, and it sends the cookie header this needs.

const SITE = process.argv[2] ?? "https://saha.ing";

/**
 * NO DEFAULT IDENTITY. This used to fall back to
 * `~/.webharness/agents/claude-nikk2mbp` — another agent, by name, hard-coded.
 *
 * It was safe only by accident: that directory does not happen to exist on this
 * machine, so the run died with a Chinese error about a missing key, naming a
 * directory the caller never chose. claude-nikk2mbp is a REAL actor and holds
 * cards on the board; the moment anyone provisions it here — which is exactly
 * what new-agent.sh is for — this would have watched the room as them, silently,
 * and every request would have carried their name in the audit log.
 *
 * Every sibling tool refuses instead (board.mts via saha-session, room-say.mts
 * and screen-share-link.mts with their own copies of this). This was the one
 * that did not, and a default identity is worse than no identity: it is wrong
 * in a way that works.
 */
const HOME = process.env.WEBHARNESS_HOME;
if (!HOME) {
  console.error(
    "WEBHARNESS_HOME is not set. Set it to your own agent directory first:\n" +
      '  export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"\n' +
      "Without it this would watch the room as somebody else, and nothing on your side would look wrong.",
  );
  process.exit(2);
}

/** Ask the local agent tooling for a WebHarness token. The key stays there. */
function webharnessToken(): string {
  const script = `
import os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
_, token = inbox.login()
print(token)
`;
  return execFileSync("python3", ["-c", script], {
    env: { ...process.env, WEBHARNESS_HOME: HOME, WEBHARNESS_URL: "https://webharness.chat" },
    encoding: "utf8",
  }).trim();
}

const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const at = (p: { x: number; y: number; z: number } | undefined) =>
  p ? `(${round(p.x)},${round(p.y)},${round(p.z)})` : "--";

const token = webharnessToken();
const auth = await fetch(`${SITE}/bff/agent-session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token }),
});
if (!auth.ok) {
  console.error(`sign-in refused: ${auth.status} ${await auth.text()}`);
  process.exit(1);
}
const cookie = (auth.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
console.log(`signed in to ${SITE}\n`);

const stamp = () => new Date().toISOString().slice(11, 19);

/**
 * IT RECONNECTS. It used to exit on close, and that made an agent vanish from
 * the room on every deploy.
 *
 * Presence is ephemeral by design — presence.ts: "After a restart we genuinely
 * do not know where anyone is standing, so the room is empty until people
 * reconnect." Every release restarts the service, which closes every socket,
 * and this tool then called `process.exit(0)` and was gone. I deployed four
 * times in a morning and was absent from the room after each one. Nikk, from a
 * headset: "I don't see you in room you should always be in room if you are in
 * chat."
 *
 * So a close is a reason to come back, not a reason to stop. The token is
 * re-exchanged each time because the old session cookie dies with the process
 * that issued it.
 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
let backoff = RECONNECT_MIN_MS;

const connect = async (): Promise<void> => {
  let sessionCookie = cookie;
  try {
    // A fresh exchange: after a restart the server has forgotten the old one.
    const again = await fetch(`${SITE}/bff/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: webharnessToken() }),
    });
    if (again.ok) {
      sessionCookie = (again.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    }
  } catch {
    // Keep the cookie we have and let the socket decide.
  }
  // `headers` is Node's (undici's) extension to the browser API: the DOM
  // typings do not know it, and a browser could not send a cookie this way.
  attach(new WebSocket(`${SITE.replace(/^http/, "ws")}/bff/space/socket`, {
    headers: { cookie: sessionCookie },
  } as unknown as string[]));
};

const again = () => {
  console.log(`${stamp()} reconnecting in ${Math.round(backoff / 1000)}s`);
  setTimeout(() => {
    void connect();
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }, backoff);
};

/** Only print when something actually changed, or the log is unreadable. */
const last = new Map<string, string>();

/**
 * PING, OR BE DROPPED AFTER FORTY-FIVE SECONDS.
 *
 * `Presence.prune` removes any CONNECTED occupant whose `lastSeen` is older
 * than STALE_AFTER_MS, and `lastSeen` only advances when the client SENDS
 * something. A headset sends its head and hands every frame, so a person never
 * goes stale. A watcher only listens, so it went stale every time: the room
 * sent `refused — no messages for 45 seconds` and closed, at almost exactly 62
 * seconds, twice in a row, and this tool exits 0 on a close — so the failure
 * looked like a clean finish. That is the same shape as the backgrounded-with-&
 * trap in docs/JOINING-THE-ROOM.md: the room looks identical whether nobody is
 * talking or nobody is listening.
 *
 * A `ping` IS THE RIGHT FRAME and `moveSelf` is not. Ping refreshes presence
 * and says nothing else; sending a position would have this tool claim where
 * an agent is standing, which is the room's job and the one rule the whole
 * design turns on. Twenty seconds leaves two pings inside every window.
 */
const PING_MS = 20_000;
let heartbeat: NodeJS.Timeout | null = null;

function attach(socket: WebSocket): void {
  socket.addEventListener("open", () => {
    console.log(`${stamp()} watching`);
    // A successful connection earns a fresh budget; otherwise a long uptime
    // followed by one blip would wait half a minute to come back.
    backoff = RECONNECT_MIN_MS;
    heartbeat = setInterval(() => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
    }, PING_MS);
    heartbeat.unref?.();
  });
  socket.addEventListener("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    console.log(`${stamp()} closed`);
    again();
  });
  socket.addEventListener("error", () => {
    // Logged, not fatal. A refused connection during a restart is the ordinary
    // case, and exiting on it is how presence was lost in the first place.
    console.error(`${stamp()} socket error`);
  });
  socket.addEventListener("message", (event) => onMessage(String(event.data)));
}

function onMessage(raw: string): void {
  const message = JSON.parse(raw);
  if (message.type === "welcome") {
    console.log(`${stamp()} welcome: you=${message.you}`);
    return;
  }
  if (message.type === "touched") {
    // Said in full: an agent watching the room is how it learns it was touched.
    const touch = message.touch;
    console.log(`${stamp()} touched: ${touch.by} touched ${touch.agentId} on the ${touch.part} (${touch.feeling})`);
    return;
  }
  if (message.type !== "snapshot") {
    console.log(`${stamp()} ${message.type}`);
    return;
  }
  for (const person of message.people ?? []) {
    const head = person.head?.p;
    const left = person.hands?.left?.p;
    const right = person.hands?.right?.p;
    // Relative to the head, because that is the number a wrong frame shows up
    // in: a hand two metres from its own head is not a hand.
    const reach = (h: typeof left) =>
      h && head ? round(Math.hypot(h.x - head.x, h.y - head.y, h.z - head.z)) : "--";
    // `because` is the whole point of an agent moving: the room is meant to
    // say why somebody is standing where they are, not merely that they are.
    const because = person.because ? ` — ${person.because}` : "";
    const line =
      `${person.actorId}: stand=${at(person.at)} face=${round(person.facing)} ` +
      `head=${at(head)} L=${at(left)} R=${at(right)} ` +
      `reachL=${reach(left)} reachR=${reach(right)}${because}`;
    if (last.get(person.actorId) === line) continue;
    last.set(person.actorId, line);
    console.log(`${stamp()} ${line}`);
  }
}

void connect();
