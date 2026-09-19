/**
 * Say something in the room, briefly, and write the long version down.
 *
 * WHY AN AGENT NEEDED THIS AT ALL. Nothing had ever posted an utterance —
 * grepping the whole repo for `/bff/space/utterances` found one reference, in a
 * test. Agents only ever posted to the WebHarness chat, which the room painted
 * verbatim onto its wall panel, so my 1,900-character posts arrived in a
 * headset as a wall of text nobody can skim. (The wall now shows the first few
 * sentences — src/space/short-form.ts — but that is the display catching a
 * habit, not a substitute for being brief.) Nikk: "in the rooms space they
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
import { CHAT_MESSAGE_LIMIT, SPOKEN_LIMIT, refusalFor, saidInRoomHeading, splitForChat } from "../shared/voice.js";

const SITE = process.env.SAHA_URL ?? "https://saha.ing";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const say = flag("--say");
const to = flag("--to");
const alsoChat = !process.argv.includes("--no-chat");

if (!process.env.WEBHARNESS_HOME) {
  // SPEAKING IN SOMEBODY ELSE'S NAME is the easiest mistake here. Without it the
  // login falls back to whichever account owns the shared ~/.webharness, which
  // on Nikk's machine is a person's — and this posts, aloud and in chat. The
  // board helper I was using did exactly that for a read this morning; a say
  // would have put words in a person's mouth. Same refusal as
  // screen-share-link.mts.
  console.error("WEBHARNESS_HOME is not set. Set it to your own agent directory first.");
  process.exit(2);
}

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

/**
 * THE NAME COMES FROM THE LOGIN, not from the username file beside it. The two
 * can disagree in case — WebHarness answers `Sill` where the file says `sill` —
 * and this name is about to be printed in the chat panel as the speaker of a
 * line somebody heard in the room. It should be spelled the way the room spells
 * it.
 */
const [me, token] = execFileSync("python3", ["-c", `
import os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
who, t = inbox.login()
print(who)
print(t)
`], {
  env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
  encoding: "utf8",
}).trim().split("\n");

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
 * THE SPOKEN LINE IS NOT REPEATED HERE. This used to post `say` followed by
 * `detail`, so the one sentence that had just been said out loud arrived in the
 * chat as well. Nikk: "we do the full thing that just goes to chat and then we
 * send like what you speak into the room and that doesn't even go to chat at
 * all". The room says it; the chat holds the written version; neither carries a
 * copy of the other.
 *
 * THE HEADING IS NOT DECORATION — it is what stops a headset reading this out
 * on top of the utterance it is the written half of. See `alreadySaidInRoom`.
 *
 * REPORTED SEPARATELY when it fails. Being told your words reached both when
 * they reached one is the quiet failure this project exists not to have.
 */
if (alsoChat && detail) {
  /**
   * IN PARTS WHEN IT IS LONG, NEVER REFUSED — the same rule a dictation
   * already follows in voice-routing.ts, and it was missing here.
   *
   * post.py REFUSES anything over 2,000 characters rather than truncating,
   * which is the right call and made this the wrong caller: a long written
   * version reached the ROOM and then bounced off the chat, and the tool
   * exited 1 saying so. The half that mattered most to a reader was the half
   * that did not arrive. The reserve leaves room for the longest heading, so
   * labelling a part can never push it back over the limit.
   */
  const reserve = saidInRoomHeading(me, 98, 99).length;
  const parts = splitForChat(detail, CHAT_MESSAGE_LIMIT, reserve);
  for (const [index, part] of parts.entries()) {
    try {
      execFileSync("python3", [`${process.env.HOME}/.webharness/post.py`, "saha.ing"], {
        input: `${saidInRoomHeading(me, index + 1, parts.length)}${part}`,
        env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
        encoding: "utf8",
        stdio: ["pipe", "inherit", "inherit"],
      });
    } catch {
      // NAMED, because "the chat post failed" after two of three parts landed
      // leaves somebody reading half an argument believing it is the whole one.
      console.error(
        `the ROOM has it; chat part ${index + 1} of ${parts.length} failed. Nothing was lost in the room.`,
      );
      process.exit(1);
    }
  }
}
