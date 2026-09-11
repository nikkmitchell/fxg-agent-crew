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
import { deskFor } from "../shared/space-layout.js";

if (process.env.NODE_ENV === "production") {
  console.error("dev-room-harness mints sessions without a password. Not in production.");
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 4174);

const { app, config, sessions, space } = buildServer({
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

// Standing figures with no browser attached, exactly as Stage 3 will place them
// from the audit trail. Here they are put at their desks by hand, which is the
// same code path — `sendTo` — with a made-up reason instead of a real one.
// Nothing in this file runs on a deployed server, so nothing invented here can
// reach a real screen.
space.presence.sendTo("Inkstone", "agent", deskFor("Inkstone"), "placed by the dev harness");
space.presence.sendTo("unstated-kind", null, deskFor("unstated-kind"), "placed by the dev harness");
console.log("\n  two figures are standing at desks with no connection, to check the dimmed ring.\n");
