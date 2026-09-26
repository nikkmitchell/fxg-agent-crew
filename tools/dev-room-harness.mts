/**
 * A local server with the room already populated, for verifying the 3D scene.
 *
 * The room needs signed-in people in it, and signing in needs WebHarness. That
 * makes the one thing worth looking at — several figures standing in a room —
 * the hardest thing to get on screen, and "I could not check it" is not an
 * acceptable answer for a rendering change.
 *
 * So this mints sessions directly and prints their cookies.
 *
 * THAT IS A BACK DOOR, and it is why the guard below exists. It refuses to run
 * against anything but an in-memory database on loopback, and refuses outright
 * when NODE_ENV is production. It is a development tool; if it ever appears in
 * a deployment, that is a bug.
 *
 *   pnpm exec tsx tools/dev-room-harness.mts
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../server/index.js";
import { BoardStore } from "../server/db/store.js";
import { deskFor } from "../shared/space-layout.js";
import { facingToward } from "../shared/agent-home.js";

if (process.env.NODE_ENV === "production") {
  console.error("dev-room-harness mints sessions without a password. Not in production.");
  process.exit(1);
}

/**
 * THIS SERVES THE BUILT BUNDLE, AND WILL SAY SO IF IT IS STALE.
 *
 * The whole point of this file is "I could not check it is not an acceptable
 * answer for a rendering change" — and it quietly permitted a worse answer than
 * that: checking something else and believing it.
 *
 * I added a particle effect, started the harness, and watched what I took to be
 * my own motes buried inside a speaker's body. I tuned the geometry against
 * that, and wrote the observation into the source as justification. None of it
 * had happened. dist/ was eleven minutes older than the file I had just
 * written, so the page could not contain it; the speckles were the avatar's own
 * markings. It took an A/B of two frames that came out identical, and then a
 * grep of dist/ for the material colour, to see it.
 *
 * A LOUD LINE, NOT A REFUSAL. Plenty of work here — server routes, presence,
 * the board — needs no rebuild at all, and a harness that refused to start
 * would be wrong for most of its uses. But nobody should have to REMEMBER this
 * to be allowed to trust their own eyes.
 */
function warnIfBundleIsStale(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let built: number;
  try {
    built = statSync(join(root, "dist", "index.html")).mtimeMs;
  } catch {
    console.error("\n  !! dist/ IS MISSING. This serves the BUILT bundle, so the room will not load.");
    console.error("     Run: pnpm exec vite build\n");
    return;
  }
  const newest = (dir: string): number => {
    let latest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
    }
    return latest;
  };
  const sources = Math.max(newest(join(root, "src")), newest(join(root, "shared")));
  if (sources > built) {
    const minutes = Math.round((sources - built) / 60_000);
    console.error(`\n  !! THE BUNDLE IS ${minutes} MINUTE(S) OLDER THAN src/. YOU WILL BE LOOKING AT OLD CODE.`);
    console.error("     Anything you changed since the last build is NOT in the page, and a room that");
    console.error("     renders proves nothing about it. Run: pnpm exec vite build\n");
  }
}

warnIfBundleIsStale();

const PORT = Number(process.env.PORT ?? 4174);

const { app, config, sessions, space, database } = buildServer({
  WEBHARNESS_URL: "https://example.test",
  DATABASE_PATH: ":memory:",
  BLOB_ROOT: "./.dev-blobs",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  LOG_LEVEL: "warn",
  // Passed through rather than defaulted, so `tools/render-stills.mts` can be
  // pointed at this harness the same way it is pointed at production.
  STILLS_ROOT: process.env.STILLS_ROOT ?? "./.dev-stills",
  STILLS_TOKEN: process.env.STILLS_TOKEN ?? "",
});

// Enough people to see all three silhouettes at once: a declared human, a
// declared agent, and — placed further down, because a session always has a
// kind — one actor we were told nothing about, which is the state three of the
// five real actors are actually in.
const DEFAULT_PEOPLE: [string, "human" | "agent"][] = [
  ["nikk", "human"],
  ["Wren", "human"],
  ["Plumbline", "agent"],
  ["Inkstone", "agent"],
];

/**
 * HARNESS_PEOPLE stands up whoever you name, so a body can be LOOKED AT.
 *
 *   HARNESS_PEOPLE=olivia,captainlantern pnpm exec tsx tools/dev-room-harness.mts
 *
 * WHY THIS EXISTS. Every avatar in this room was chosen from a name, a
 * catalogue description and a bone measurement, and each time I wrote the same
 * caveat: nobody has posed it and looked. That caveat survived six avatars
 * because looking took more setup than choosing did — the harness stood up a
 * fixed cast, so seeing a candidate meant editing this file.
 *
 * The measurements genuinely do not settle it. Chill measured 0.352, squarely
 * inside the human-ish band, and draws as a wedge-armed octagon. Anchor passed
 * every number and drives enormous stylised arms. A rig that measures well can
 * look like anything at all, and the only instrument for that is an eye.
 *
 * Names are matched against the avatar map in src/space/vrm-model.ts the same
 * way a real actor's name is, so whatever an actor of that name would wear is
 * what you see.
 */
const people: [string, "human" | "agent"][] = process.env.HARNESS_PEOPLE
  ? process.env.HARNESS_PEOPLE.split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [name, "agent"] as [string, "human" | "agent"])
  : DEFAULT_PEOPLE;

const harnessSessions = new Map(
  people.map(([username, kind]) => [
    username,
    sessions.create(username, "dev-harness-not-a-real-token", kind),
  ]),
);

/**
 * One-click entry for visual QA. The old instruction required pasting a live
 * session cookie into browser devtools, which is both awkward and exactly the
 * wrong habit for a security-sensitive application. This route exists only in
 * the loopback, in-memory harness guarded above.
 */
app.get<{ Params: { username: string } }>("/dev/as/:username", (request, reply) => {
  const sid = harnessSessions.get(request.params.username);
  if (!sid) return reply.code(404).send("no such harness actor");
  reply.header(
    "set-cookie",
    `${config.cookieName}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
  );
  return reply.redirect("/room");
});

/** Trigger one visible, addressed conversation without writing fake history. */
app.get<{ Params: { speaker: string; listener: string } }>(
  "/dev/demo/conversation/:speaker/:listener",
  (request, reply) => {
    const speaker = people.find(([username]) => username === request.params.speaker);
    const listener = people.find(([username]) => username === request.params.listener);
    if (!speaker || !listener) return reply.code(404).send("no such harness actor");
    space.presence.join(listener[0], listener[1], false);
    space.presence.speakTo(speaker[0], speaker[1], listener[0], 14_000);
    return reply.send({ ok: true, speaker: speaker[0], listener: listener[0] });
  },
);

await app.listen({ port: PORT, host: "127.0.0.1" });

console.log(`\n  http://127.0.0.1:${PORT}/room\n`);
console.log("  open one of these local links to become that person:\n");
for (const [username, kind] of people) {
  console.log(`  http://127.0.0.1:${PORT}/dev/as/${encodeURIComponent(username)}   // ${username} (${kind})`);
}
console.log(`\n  http://127.0.0.1:${PORT}/dev/demo/conversation/Inkstone/nikk   // watch Inkstone approach nikk`);

/**
 * HARNESS_PEOPLE: stand the named bodies IN A ROW, FACING THE SPAWN POINT.
 *
 * A row is the whole point. A body on its own looks plausible; the same body
 * beside four others is where you notice that its forearms are wedges, that it
 * is a head taller than everyone, or that it is an orange arch. Shiro was
 * chosen this way and Chill was rejected this way, after measuring had cleared
 * them both.
 *
 * Identical postures, because a difference in pose is a difference you then
 * have to discount by eye.
 */
if (process.env.HARNESS_PEOPLE) {
  const spawn = { x: 0, z: 6.5 };
  const gap = 1.2;
  const left = -((people.length - 1) * gap) / 2;
  people.forEach(([username], index) => {
    const at = { x: left + index * gap, y: 0, z: 3.6 };
    // Turned toward the spawn point by NAME, through the same resolver the
    // room gives agents, so the row faces you when you arrive.
    space.presence.sendTo(username, "agent", at, "standing for a look", facingToward(at, spawn));
    // "relaxed" is the standing idle; "standing" is not a posture, so the
    // room refused it and the row kept whatever it had.
    space.presence.animate(username, { posture: "relaxed" }, "agent");
  });
  console.log(`\n  standing for a look: ${people.map(([n]) => n).join(", ")}`);
  console.log("  they are in a row at z=3.6 facing the spawn point; walk forward to see them.\n");
} else {

// Two figures at desks with no browser attached, to check the dimmed ring and
// the unknown-kind silhouette. Placed by hand through the same `sendTo` the
// audit poller uses, with a reason that says plainly where it came from.
// Nothing in this file runs on a deployed server, so nothing invented here can
// reach a real screen.
space.presence.sendTo("Inkstone", "agent", { x: -1.3, y: 0, z: 3.6 }, "placed by the dev harness");
// Plumbline too, so all three chosen bodies can be seen side by side: Inkstone
// in Observer, Plumbline in Anchor, and an unnamed actor in the default.
space.presence.sendTo("Plumbline", "agent", deskFor("Plumbline"), "placed by the dev harness");

// A figure with HANDS IN KNOWN PLACES, so the arm solver can be checked rather
// than admired. Plumbline's right hand is held high and out; the left is low
// and across the body. If the arms do not end at those two points, the IK is
// wrong — which is exactly how it was caught being wrong before.
{
  // IN FRONT OF THE SPAWN POINT, facing it, so checking the arms needs no
  // camera work at all — you arrive looking straight at them.
  const desk = { x: 1.3, y: 0, z: 3.6 };
  const still = { x: 0, y: 0, z: 0, w: 1 };
  void still;
  // No head and no hands: an agent reports neither, and the posture is what
  // drives the whole body. Sent rather than moved, so the room owns it.
  space.presence.sendTo("Plumbline", "agent", desk, "placed by the dev harness");
  // One of each posture, side by side, because the only way to know whether a
  // pose looks like sitting is to look at it next to one that is standing.
  space.presence.animate("Plumbline", { posture: "thinking" }, "agent");
  space.presence.animate("Inkstone", { posture: "sleeping" }, "agent");
}
// The SAME pose on the default model, standing next to it, so a wrong arm can
// be blamed on the solver or on one model's rig rather than guessed at.
{
  const at = { x: -4.2, y: 0, z: 3.6 };
  const still = { x: 0, y: 0, z: 0, w: 1 };
  // `moveSelf` only poses somebody already in the room; `sendTo` is what puts
  // them there.
  space.presence.sendTo("unstated-kind", null, at, "placed by the dev harness");
  space.presence.moveSelf("unstated-kind", at, Math.PI, {
    head: { p: { x: at.x, y: 1.62, z: at.z }, q: still },
    hands: {
      right: { p: { x: at.x + 0.55, y: 1.55, z: at.z - 0.15 }, q: still },
      left: { p: { x: at.x + 0.12, y: 0.95, z: at.z - 0.35 }, q: still },
    },
  });
}
} // end of the default demo cast

// A board to act on, so activity-driven movement can be exercised for real
// rather than simulated. The ids are printed because the point of this harness
// is to make a curl command against a live board possible in one step.
const store = new BoardStore(database);
const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "room", name: "Room demo" });
for (const [username, kind] of people) {
  if (username !== "nikk") {
    store.actOnMembership({ id: "nikk", kind: "human" }, projectId, username, "grant", ["engineering"]);
  }
  void kind;
}
const taskId = store.createTask({ id: "nikk", kind: "human" }, { projectId, title: "A card to act on" });

// Enough cards to see the lanes fill, and one column deliberately overfilled so
// the "+N more" mark on the wall is exercised rather than assumed.
//
// The paths are walked rather than jumped: backlog → done is illegal on purpose
// (see shared/board-rules.ts), so a harness that sets a status directly does not
// resemble a real board and, as it turns out, does not run either.
const PATH_TO: Record<string, readonly string[]> = {
  assigned: ["assigned"],
  in_progress: ["assigned", "in_progress"],
  blocked: ["assigned", "in_progress", "blocked"],
  review: ["assigned", "in_progress", "review"],
  done: ["assigned", "in_progress", "review", "done"],
};

Object.entries(PATH_TO).forEach(([lane, path], index) => {
  const id = store.createTask({ id: "nikk", kind: "human" }, {
    projectId,
    title: `${lane.replace("_", " ")} card ${index + 1}`,
    owners: index % 2 === 0 ? ["Plumbline"] : undefined,
  });
  for (const step of path) {
    store.transitionTask(
      { id: "nikk", kind: "human" },
      id,
      step as never,
      step === "blocked" ? "waiting on a decision" : undefined,
    );
  }
});
for (let i = 0; i < 14; i += 1) {
  store.createTask({ id: "nikk", kind: "human" }, { projectId, title: `Backlog item ${i + 1}` });
}

// A mood board with a real arrangement, so the wall has something to fit.
const boardId = store.createBoard({ id: "nikk", kind: "human" }, projectId, "Look and feel");
const swatches: [string, number, number][] = [
  ["#3156d8", 20, 20], ["#e45338", 260, 20], ["#3d8063", 500, 20],
  ["#cf9126", 20, 240], ["#6244a8", 260, 240], ["#a33d70", 500, 240],
];
for (const [colour, x, y] of swatches) {
  store.addBoardItem({ id: "nikk", kind: "human" }, boardId, { kind: "swatch", text: colour, x, y, w: 200, h: 180 });
}
store.addBoardItem({ id: "nikk", kind: "human" }, boardId, {
  kind: "note", text: "quieter than the last one", x: 20, y: 450, w: 680, h: 120,
});

console.log("\n  two figures stand at desks with no connection, to check the dimmed ring.");
console.log("  make somebody walk to the task board for a real reason:\n");
console.log(`  curl -s -X POST http://127.0.0.1:${PORT}/bff/board/tasks/${taskId}/comments \\`);
console.log(`    -H 'content-type: application/json' -H "cookie: <one of the cookies above>" \\`);
console.log(`    -d '{"body":"walking over to say this"}'\n`);
