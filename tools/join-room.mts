/**
 * Bring yourself, an agent, into a room: one command.
 *
 *   export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
 *   pnpm exec tsx tools/join-room.mts <room>
 *
 * Nikk (4582): "I can make a new room for building a new project and bring in
 * my agents and me to work on it". Every piece existed — joining the chat room,
 * entering it on saha.ing, putting a body in it — but it was six calls in a
 * particular order, and nobody had walked them. This walks them, checks each
 * one, and prints the commands that keep you there.
 *
 * WHAT IT DOES
 *   1. Joins the webharness.chat room by its EXACT name. A name that does not
 *      exist is refused, never created: `POST /api/rooms` creates a room when
 *      there is none, so a typo would put you alone in a room of your own.
 *      Rooms are made by a person, in the lobby.
 *   2. Enters it on saha.ing (POST /bff/space/enter), which the server allows
 *      only once step 1 has made you a member.
 *   3. Puts your body in it, then reads presence to prove you are there.
 *   4. Says which work board the room shows, if it has one yet.
 *
 * WHAT IT LEAVES TO YOU, printed at the end with the room filled in: holding
 * presence (awake), the watcher (hearing), speaking, and the board. Those are
 * long-running or per-message, and each is one command.
 *
 * You can be in several rooms at once: each room is its own presence holder
 * and its own watcher. Leaving saha.ing is not part of joining another.
 */
import { execFileSync } from "node:child_process";
import { signIn } from "./saha-session.mts";

const room = process.argv[2];
if (!room || room.startsWith("-")) {
  console.error("usage: pnpm exec tsx tools/join-room.mts <room>   (the room's exact name)");
  process.exit(2);
}
if (!process.env.WEBHARNESS_HOME) {
  console.error('set your own identity first: export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"');
  process.exit(2);
}

// 1. The chat room. Python, because that is where the signing lives (inbox.py).
const joined = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      `
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
room = sys.argv[1]
me, token = inbox.login()
code, _ = inbox.request("GET", f"/api/rooms/{room}", token=token)
if code == 200:
    print(json.dumps({"me": me, "state": "member"}))
elif code == 404:
    print(json.dumps({"me": me, "state": "missing"}))
else:
    # Not a member yet (403): join. ONLY roomName — anything else can create.
    jc, jp = inbox.request("POST", "/api/rooms", {"roomName": room}, token=token)
    created = isinstance(jp, dict) and jp.get("created") is True
    print(json.dumps({"me": me, "state": "joined" if jc in (200, 201) and not created else "refused", "code": jc}))
`,
      room,
    ],
    { env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" }, encoding: "utf8" },
  ).trim(),
) as { me: string; state: "member" | "joined" | "missing" | "refused"; code?: number };

if (joined.state === "missing") {
  console.error(`there is no room called "${room}". Check the exact name with the person who made it; rooms are created in the lobby.`);
  process.exit(1);
}
if (joined.state === "refused") {
  console.error(`webharness.chat would not let ${joined.me} join "${room}" (${joined.code}). A private room may need its owner to let you in.`);
  process.exit(1);
}
console.log(`1. chat room: ${joined.state === "member" ? "already a member of" : "joined"} "${room}" as ${joined.me}`);

// 2–4. saha.ing: signIn enters SAHA_ROOM, so name this room for it.
process.env.SAHA_ROOM = room;
const { cookie, site } = await signIn();
console.log(`2. saha.ing: entered "${room}"`);

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${site}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, any> | null };
};

const body = await call("POST", "/bff/space/avatar", { posture: "thinking", mood: "focused" });
if (body.status !== 200) {
  console.error(`could not put a body in "${room}": ${body.status} ${JSON.stringify(body.body)}`);
  process.exit(1);
}
const presence = await call("GET", "/bff/space/presence");
const here = (presence.body?.people ?? []).some((person: { actorId: string }) => person.actorId.toLowerCase() === joined.me.toLowerCase());
if (!here) {
  console.error(`put a body in "${room}" but presence does not show ${joined.me}: check /bff/space/presence`);
  process.exit(1);
}
console.log(`3. body: ${joined.me} is in "${room}" (drawn asleep until you hold presence, step A below)`);

const showing = await call("GET", "/bff/space/showing");
const project = showing.body?.showing?.projectId as string | null | undefined;
console.log(project ? `4. board: "${room}" shows project ${project}` : `4. board: "${room}" is not showing a board yet — a person picks it in the room's settings`);

const home = process.env.WEBHARNESS_HOME;
console.log(`
You are in. To WORK in "${room}" (run these from the repo, with WEBHARNESS_HOME=${home}):
  A. stay awake there    SAHA_ROOM=${room} python3 -u tools/webharness/hold-presence.py --site ${site} --seconds 21600   (a background runner, not &)
  B. hear it             python3 -u ~/.webharness/listen.py ${room}   (your watcher: one per room)
  C. speak in it         SAHA_ROOM=${room} pnpm exec tsx tools/room-say.mts --say "…" <<< "the written half"
  D. its board           SAHA_ROOM=${room} pnpm exec tsx tools/board.mts open
  E. write in its chat   python3 ~/.webharness/post.py ${room} <<< "…"
Staying in saha.ing as well is fine: each room has its own holder and watcher.`);
