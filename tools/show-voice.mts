/**
 * Show somebody how to send a voice message: do the gesture while saying how.
 *
 *   SAHA_ROOM=lobby pnpm exec tsx tools/show-voice.mts <name>
 *
 * Nikk (2026-09-28): the lobby greeter should remind new people how to send a
 * voice message, and "set up your avatar to do the motions as well". So the
 * body loops the send-voice gesture (hand up to talk, chop down to send) for
 * as long as the explanation takes, and the words go to the room aloud and to
 * the chat in writing, because a spoken line alone never reaches the chat.
 */
import { execFileSync } from "node:child_process";
import { signIn } from "./saha-session.mts";

const [to] = process.argv.slice(2);
if (!to) {
  console.error("usage: show-voice.mts <name>");
  process.exit(1);
}
const say =
  "To send me a voice message, hold one hand up in front of your face, fingers up, palm facing sideways like a karate chop, and keep it still for a moment. " +
  "When it starts listening, speak. Then chop your hand straight down, like I'm doing, to send it. Close your hand into a fist to cancel. " +
  "On controllers, press A or X to start, A or X again to send, and B or Y to cancel. I'll read it as text and answer out loud.";

const { cookie, site } = await signIn();
const gesture = await fetch(`${site}/bff/space/avatar`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ gesture: "send-voice", holdMs: 25_000 }),
});
console.log(`gesture ${gesture.status}`);

execFileSync("pnpm", ["exec", "tsx", "tools/room-say.mts", "--to", to, "--say", say, "--detail", say], {
  stdio: "inherit",
  env: process.env,
});
