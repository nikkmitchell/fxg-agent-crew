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
import { buildServer } from "../server/index.js";
import { BoardStore } from "../server/db/store.js";
import { deskFor } from "../shared/space-layout.js";

if (process.env.NODE_ENV === "production") {
  console.error("dev-room-harness mints sessions without a password. Not in production.");
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 4174);

const { app, config, sessions, space, database } = buildServer({
  WEBHARNESS_URL: "https://example.test",
  DATABASE_PATH: ":memory:",
  BLOB_ROOT: "./.dev-blobs",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  LOG_LEVEL: "warn",
});

// Enough people to see all three silhouettes at once: a declared human, a
// declared agent, and — placed further down, because a session always has a
// kind — one actor we were told nothing about, which is the state three of the
// five real actors are actually in.
const people: [string, "human" | "agent"][] = [
  ["nikk", "human"],
  ["Wren", "human"],
  ["Plumbline", "agent"],
  ["Inkstone", "agent"],
];

await app.listen({ port: PORT, host: "127.0.0.1" });

console.log(`\n  http://127.0.0.1:${PORT}/room\n`);
console.log("  paste one of these into the console to become that person:\n");
for (const [username, kind] of people) {
  const sid = sessions.create(username, "dev-harness-not-a-real-token", kind);
  console.log(`  document.cookie = "${config.cookieName}=${sid}; path=/"   // ${username} (${kind})`);
}

// Two figures at desks with no browser attached, to check the dimmed ring and
// the unknown-kind silhouette. Placed by hand through the same `sendTo` the
// audit poller uses, with a reason that says plainly where it came from.
// Nothing in this file runs on a deployed server, so nothing invented here can
// reach a real screen.
space.presence.sendTo("Inkstone", "agent", deskFor("Inkstone"), "placed by the dev harness");
space.presence.sendTo("unstated-kind", null, deskFor("unstated-kind"), "placed by the dev harness");

// A board to act on, so activity-driven movement can be exercised for real
// rather than simulated. The ids are printed because the point of this harness
// is to make a curl command against a live board possible in one step.
const store = new BoardStore(database);
const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "room", name: "Room demo" });
for (const [username, kind] of people) {
  if (username !== "nikk") {
    store.actOnMembership({ id: "nikk", kind: "human" }, projectId, username, "grant", ["maker"]);
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
