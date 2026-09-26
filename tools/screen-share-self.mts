/**
 * Share this machine's screen into the room, and keep it shared, with no
 * browser tab and no one pressing Start.
 *
 * Nikk (4821): "we have to keep starting up the screen sharing ... when it goes
 * down I need to restart it. Is there a way ... for an agent to check if their
 * screen share is off and then they can turn it back on on their own".
 *
 * WHY NOT THE SHARE PAGE. share.html uses the browser's screen capture, which
 * by design only starts after a person clicks and picks what to show, and
 * stops when the tab sleeps or closes. An agent cannot press that button and
 * should not get around it. So this captures with macOS's own `screencapture`
 * and uploads each picture to the same frame route the page uses, signed in
 * as the agent. It restarts itself: a failed upload is retried, an expired
 * sign-in is renewed, and it runs until stopped.
 *
 * ONCE, A PERSON: macOS asks for Screen Recording permission for the terminal
 * running this (System Settings > Privacy & Security > Screen Recording). That
 * is the person's choice to make; this never changes it. Without it, macOS
 * returns only the desktop, and this says so and stops.
 *
 *   export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
 *   pnpm exec tsx tools/screen-share-self.mts            share, every 1.5 s, until stopped
 *   pnpm exec tsx tools/screen-share-self.mts --status   is my screen live in the room?
 *   pnpm exec tsx tools/screen-share-self.mts --stop     take it down
 *
 * Run the sharing form under a background runner, not `&`, like the presence
 * holder. SAHA_ROOM picks the room. Stopping it (Ctrl-C, or the runner) takes
 * the picture down, so the room never shows a frozen screen.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signIn } from "./saha-session.mts";

const EVERY_MS = Number(process.env.SHARE_EVERY_MS ?? 1500);
const MAX_SIDE = 1600;
const mode = process.argv[2] ?? "";

let session = await signIn();
const call = (method: string, path: string, body?: Buffer, type?: string) =>
  fetch(`${session.site}${path}`, {
    method,
    headers: { cookie: session.cookie, ...(type ? { "content-type": type } : {}) },
    body: body ? new Uint8Array(body) : undefined,
  });
const me = ((await (await call("GET", "/bff/me")).json()) as { username: string }).username;

async function status(): Promise<{ live: boolean; age: number | null }> {
  const list = ((await (await call("GET", "/bff/space/screens")).json()) as { screens: { actorId: string; updatedAt: string }[] }).screens;
  const mine = list.find((s) => s.actorId.toLowerCase() === me.toLowerCase());
  return mine ? { live: true, age: Math.max(0, Math.round((Date.now() - Date.parse(mine.updatedAt)) / 1000)) } : { live: false, age: null };
}

if (mode === "--status") {
  const s = await status();
  console.log(s.live ? `${me}'s screen is LIVE (last picture ${s.age}s ago)` : `${me}'s screen is NOT being shared`);
  process.exit(0);
}
if (mode === "--stop") {
  const r = await call("DELETE", "/bff/space/screens/frame");
  console.log(r.ok ? "screen share stopped" : `could not stop: ${r.status}`);
  process.exit(r.ok ? 0 : 1);
}

const dir = mkdtempSync(join(tmpdir(), "saha-share-"));
const shot = join(dir, "screen.jpg");

/** One picture, small enough to upload quickly, or null with why. */
function capture(): Buffer | null {
  try {
    execFileSync("screencapture", ["-x", "-t", "jpg", shot], { stdio: "ignore" });
    execFileSync("sips", ["-Z", String(MAX_SIDE), "-s", "formatOptions", "60", shot], { stdio: "ignore" });
    if (statSync(shot).size === 0) return null;
    return readFileSync(shot);
  } catch {
    return null;
  }
}

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await call("DELETE", "/bff/space/screens/frame").catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
  console.log("screen share stopped");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`sharing ${me}'s screen into the room, every ${EVERY_MS / 1000}s — stop to take it down`);
let failures = 0;
let said = "";
const note = (line: string) => {
  if (line !== said) console.log(line);
  said = line;
};
for (;;) {
  const frame = capture();
  if (!frame) {
    note("could not take a picture: grant Screen Recording to this terminal in System Settings > Privacy & Security, then run again");
    await stop();
  }
  try {
    let response = await call("PUT", "/bff/space/screens/frame", frame!, "image/jpeg");
    if (response.status === 401) {
      // The sign-in lapsed: sign in again and send the same picture.
      session = await signIn();
      response = await call("PUT", "/bff/space/screens/frame", frame!, "image/jpeg");
    }
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    failures = 0;
    note("live");
  } catch (error) {
    // A dropped connection or a deploy: keep trying, a little slower each time.
    failures += 1;
    note(`upload failed (${failures}), retrying: ${error instanceof Error ? error.message : error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, failures ? Math.min(30_000, EVERY_MS * 2 ** failures) : EVERY_MS));
}
