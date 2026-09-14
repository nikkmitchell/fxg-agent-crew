/**
 * Say something in the room, briefly, and write the long version down.
 *
 * WHY AN AGENT NEEDED THIS AT ALL. Nothing had ever posted an utterance —
 * grepping the whole repo for `/bff/space/utterances` found one reference, in a
 * test. Agents only ever posted to the WebHarness chat, which the room paints
 * verbatim onto its wall panel, so my 1,900-character posts arrived in a
 * headset as a wall of text nobody can skim. Nikk: "in the rooms space they
 * should be limmited to a 1 or few sentance tight summary of what they are
 * saying", and separately "I saw your message in chat but I didn't hear it
 * inside of the room".
 *
 * The mechanism was already there and unused. `shared/voice.ts` splits every
 * utterance into `say` — spoken aloud, capped at 240 characters — and `detail`,
 * written and never spoken. Its own comment: "giving them one field would have
 * made brevity depend on everyone remembering to be brief."
 *
 * THE SHORT FORM IS WRITTEN BY THE SPEAKER, NOT CUT BY A MACHINE. Trimming a
 * sentence to fit turns "I would not merge this" into something that means the
 * opposite, and the room would then have said a thing nobody said. So `--say`
 * is required and refused if it is too long, exactly as the server refuses it.
 * Nothing here shortens anything.
 *
 *   echo "the long version" | pnpm exec tsx tools/room-say.mts --say "the short one"
 *
 * `--to <actor>` addresses somebody, which is what makes the room turn the
 * speaker toward them. `--no-chat` keeps it to the room alone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SPOKEN_LIMIT, refusalFor } from "../shared/voice.js";

const SITE = process.env.SAHA_URL ?? "https://saha.ing";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const say = flag("--say");
const to = flag("--to");
const alsoChat = !process.argv.includes("--no-chat");

if (!say) {
  console.error(
    "usage: echo <detail> | room-say.mts --say <short form> [--to actor] [--no-chat]\n\n" +
      "The short form is what the room speaks aloud and draws over your head.\n" +
      `It must be ${SPOKEN_LIMIT} characters or fewer, and it is YOUR words — nothing\n` +
      "here shortens anything for you.",
  );
  process.exit(2);
}

// Stdin may be empty: something short enough to say needs no written version.
let detail = "";
try {
  detail = readFileSync(0, "utf8").trim();
} catch {
  detail = "";
}

const input = {
  say,
  ...(detail ? { detail } : {}),
  ...(to ? { to } : {}),
  source: "text" as const,
};

// REFUSED HERE FIRST, with the server's own rule, so the failure arrives as a
// sentence in a terminal rather than as a 422 nobody reads.
const refused = refusalFor(input);
if (refused) {
  console.error(`refused: ${refused}`);
  process.exit(1);
}

const token = execFileSync("python3", ["-c", `
import os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
_, t = inbox.login()
print(t)
`], {
  env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
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

const said = await fetch(`${SITE}/bff/space/utterances`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify(input),
});
if (!said.ok) {
  console.error(`the room refused it: ${said.status} ${await said.text()}`);
  process.exit(1);
}
console.log(`room: said ${say.length} chars aloud${detail ? `, wrote ${detail.length}` : ""}`);

/**
 * AND THE FULL VERSION TO THE CHAT, because the two are for different readers.
 * Nikk: "they can still send that in the main chat for other agents to have a
 * deep discussion". The room gets a sentence somebody in a headset can take in;
 * the chat keeps the whole argument for whoever wants to read it at their own
 * speed.
 *
 * REPORTED SEPARATELY when it fails. Being told your words reached both when
 * they reached one is the quiet failure this project exists not to have.
 */
if (alsoChat && detail) {
  try {
    execFileSync("python3", [`${process.env.HOME}/.webharness/post.py`, "saha.ing"], {
      input: `${say}\n\n${detail}`,
      env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch {
    console.error("the ROOM has it; the chat post failed. Nothing was lost in the room.");
    process.exit(1);
  }
}
