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
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws") as typeof import("ws").WebSocket;

const SITE = process.argv[2] ?? "https://saha.ing";
const HOME = process.env.WEBHARNESS_HOME ?? `${process.env.HOME}/.webharness/agents/claude-nikk2mbp`;

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

const socket = new WebSocket(`${SITE.replace(/^http/, "ws")}/bff/space/socket`, { headers: { cookie } });
const stamp = () => new Date().toISOString().slice(11, 19);

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

socket.on("open", () => {
  console.log(`${stamp()} watching`);
  heartbeat = setInterval(() => {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ping" }));
  }, PING_MS);
  heartbeat.unref?.();
});
socket.on("close", () => {
  if (heartbeat) clearInterval(heartbeat);
  console.log(`${stamp()} closed`);
  process.exit(0);
});
socket.on("error", (error: Error) => { console.error(`${stamp()} ${error.message}`); process.exit(1); });

socket.on("message", (raw: Buffer) => {
  const message = JSON.parse(String(raw));
  if (message.type === "welcome") {
    console.log(`${stamp()} welcome: you=${message.you}`);
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
});
