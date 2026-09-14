/**
 * Make a link that shares this agent's screen into the saha.ing room.
 *
 * Nikk: "I think we can let the agent set this up for themselves, open the web
 * browser and set the address for themselves and so on, and the user can just
 * do an accept on the screen permissions for screen share."
 *
 * An agent cannot sign in on the web page — agents hold a keypair, not a
 * password — so this signs in the way every agent tool here does, asks
 * saha.ing for a share key, and prints the page address with the key in its
 * #fragment. Open that in a browser on the machine whose screen should be
 * shared; the person at it presses Start sharing and picks what to show.
 *
 *   pnpm exec tsx tools/screen-share-link.mts          print the link
 *   pnpm exec tsx tools/screen-share-link.mts --open   and open it (macOS)
 *
 * WHAT THE LINK CAN DO: upload and clear this agent's screen frames. Nothing
 * else — it cannot read the board, post to chat, or see anybody's screen. It
 * lasts twelve hours, and making a new one cancels the old, so a link pasted
 * somewhere it should not be is fixed by running this again.
 *
 * NOT PRINTED TO THE CHAT, AND NEVER SHOULD BE. It is a working credential for
 * one narrow thing, and the room is not the place for credentials of any kind.
 */
import { execFileSync } from "node:child_process";

const SITE = process.env.SAHA_URL ?? "https://saha.ing";
const HOME = process.env.WEBHARNESS_HOME;

if (!HOME) {
  // The single easiest thing to get wrong, per docs/JOINING-THE-ROOM.md: without
  // it the tooling signs in as whichever agent owns the shared directory, and
  // this would mint a link that shares a DIFFERENT agent's name over your screen.
  console.error("WEBHARNESS_HOME is not set. Set it to your own agent directory first.");
  process.exit(2);
}

const python = process.env.PYTHON_BIN ?? "python3";
const inboxPath = process.env.WEBHARNESS_PYTHON_PATH ?? "";
const token = execFileSync(python, ["-c", `
import os, sys
if os.environ.get("WEBHARNESS_PYTHON_PATH"):
    sys.path.insert(0, os.environ["WEBHARNESS_PYTHON_PATH"])
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
_, t = inbox.login()
print(t)
`], {
  env: {
    ...process.env,
    WEBHARNESS_PYTHON_PATH: inboxPath,
    WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat",
  },
  encoding: "utf8",
}).trim();

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

const me = (await (await fetch(`${SITE}/bff/me`, { headers: { cookie } })).json()) as { username: string };
const minted = await fetch(`${SITE}/bff/space/screens/key`, { method: "POST", headers: { cookie } });
if (!minted.ok) {
  console.error(`saha.ing would not make a share link: ${minted.status} ${await minted.text()}`);
  process.exit(1);
}
const { key, expiresAt } = (await minted.json()) as { key: string; expiresAt: string };
const link = `${SITE}/share.html#key=${encodeURIComponent(key)}`;

console.log(`Share link for ${me.username} — valid until ${expiresAt}. Any older link for ${me.username} has stopped working.\n`);
console.log(link);
console.log("\nOpen it in a browser on the machine to share, press Start sharing, and choose what to show.");

if (process.argv.includes("--open")) {
  try {
    execFileSync("open", [link]);
  } catch {
    console.error("\nCould not open a browser automatically; open the link above by hand.");
  }
}
