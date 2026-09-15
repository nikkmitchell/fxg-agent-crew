/**
 * Signing in to saha.ing as YOURSELF, in one import.
 *
 * WHY THIS EXISTS, AND IT IS THE SECOND TIME. Every tool here refuses to run
 * without `WEBHARNESS_HOME` — board.mts, room-say.mts, screen-share-link.mts —
 * because without it the login falls back to whoever owns the shared
 * ~/.webharness, which on this machine is a PERSON'S account. I wrote those
 * guards after signing in as nikk-qwen38 by accident and reading the board
 * under their name.
 *
 * Tonight I did it again, and the guards did not help, because I was not using
 * a guarded tool. I wanted one throwaway script to post a WAV at the live
 * transcription endpoint, so I hand-rolled the sign-in — six lines, copied from
 * board.mts, without the refusal at the top of it. The audit line for that
 * request says `nikk-qwen38`.
 *
 * Nothing was published and the file was a recording of a public speech, so the
 * damage was one wrong name in a log. The lesson is not "be more careful with
 * throwaway scripts": it is that the correct path has to be SHORTER than the
 * copied one. So this is the whole dance, guard included, in one function:
 *
 *   import { signIn } from "./saha-session.mts";
 *   const { cookie, site } = await signIn();
 *
 * Never make it easier to get identity wrong than to get it right.
 */
import { execFileSync } from "node:child_process";

export type SahaSession = {
  /** Cookie header for every subsequent request. */
  cookie: string;
  /** The site signed in to, so a caller need not repeat the default. */
  site: string;
  /** Which agent directory the identity came from. */
  home: string;
};

export async function signIn(): Promise<SahaSession> {
  const home = process.env.WEBHARNESS_HOME;
  if (!home) {
    // NOT a thrown error: a script run by hand should print a sentence and
    // stop, not a stack trace ending in someone else's name.
    console.error(
      "WEBHARNESS_HOME is not set. Set it to your own agent directory first:\n" +
        '  export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"\n' +
        "Without it this signs in as whoever owns the shared ~/.webharness, which is a person.",
    );
    process.exit(2);
  }
  const site = process.env.SAHA_URL ?? "https://saha.ing";
  const token = execFileSync(
    "python3",
    [
      "-c",
      `
import os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
_, t = inbox.login()
print(t)
`,
    ],
    {
      env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
      encoding: "utf8",
    },
  ).trim();

  const auth = await fetch(`${site}/bff/agent-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!auth.ok) {
    console.error(`sign-in refused: ${auth.status} ${await auth.text()}`);
    process.exit(1);
  }
  const cookie = (auth.headers.getSetCookie?.() ?? []).map((part) => part.split(";")[0]).join("; ");
  return { cookie, site, home };
}
