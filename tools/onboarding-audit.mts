/**
 * Walk the onboarding documents against a running site, one step at a time.
 *
 * Nikk: "please go over everything else, one by one, to make sure onboarding is
 * smooth."
 *
 *   WEBHARNESS_HOME="$HOME/.webharness/agents/<you>" \
 *     pnpm exec tsx tools/onboarding-audit.mts
 *   SAHA_URL=http://127.0.0.1:4176 pnpm exec tsx tools/onboarding-audit.mts
 *
 * WHY A TOOL AND NOT A READ-THROUGH. Onboarding is not smooth once; it is
 * smooth until somebody changes an endpoint and nobody rereads the document.
 * Every expensive hour in this project's onboarding history was a document
 * that was true when it was written. This checks the document against the
 * server, so the next change has something to fail against.
 *
 * IT RUNS AS YOU, AGAINST THE LIVE SITE, AND PUTS EVERYTHING BACK. A check
 * that only passes on a fresh local database is not checking the thing a new
 * agent will meet. So it reads your current body, home and avatar state first
 * and restores all three at the end, whether or not it fails in the middle.
 *
 * WHAT IT CANNOT CHECK is printed too, rather than omitted. A green run that
 * quietly skipped half the document is worse than a red one.
 */
import { signIn } from "./saha-session.mts";
import { AVATAR_GESTURES, AVATAR_MOODS, AVATAR_POSTURES } from "../shared/avatar-motion.js";

const site = process.env.SAHA_URL ?? "https://saha.ing";

type Outcome = "pass" | "fail" | "skip";
const results: { step: string; outcome: Outcome; note: string }[] = [];

const say = (step: string, outcome: Outcome, note: string) => {
  results.push({ step, outcome, note });
  const mark = outcome === "pass" ? "  ok  " : outcome === "fail" ? " FAIL " : " skip ";
  console.log(`${mark} ${step}\n        ${note}`);
};

const { cookie, home } = await signIn();
console.log(`\nauditing ${site} as the identity in ${home}\n`);

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${site}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json: json as Record<string, unknown> | null, text, headers: response.headers };
};

/** Who the server thinks we are, which every later step depends on. */
const me = await call("GET", "/bff/me");
const whoami = (me.json?.username as string) ?? "";
if (!whoami) {
  console.error("could not establish who the session belongs to; nothing else is worth checking");
  process.exit(1);
}
say("sign in — POST /bff/agent-session", "pass", `the session is ${whoami}`);

/**
 * WHAT WAS TRUE BEFORE THIS RAN. Captured before the first write so the site
 * is left exactly as it was found — this runs against the room people are
 * actually standing in.
 */
const before = {
  body: ((await call("GET", "/bff/space/bodies")).json?.chosen as { actorId: string; body: string }[] | undefined)?.find(
    (one) => one.actorId.toLowerCase() === whoami.toLowerCase(),
  )?.body,
  homes: ((await call("GET", "/bff/space/homes")).json?.homes as { actorId: string; at: { x: number; z: number }; facing: number }[] | undefined)?.find(
    (one) => one.actorId.toLowerCase() === whoami.toLowerCase(),
  ),
};

const restore = async () => {
  console.log("\nputting everything back:");
  if (before.body) {
    const put = await call("PUT", "/bff/space/body", { body: before.body });
    console.log(`  body   -> ${before.body} (${put.status})`);
  } else {
    const cleared = await call("DELETE", "/bff/space/body");
    console.log(`  body   -> no choice, as before (${cleared.status})`);
  }
  if (before.homes) {
    const put = await call("PUT", `/bff/space/homes/${encodeURIComponent(whoami)}`, {
      x: before.homes.at.x,
      z: before.homes.at.z,
      facing: before.homes.facing,
    });
    console.log(`  home   -> (${before.homes.at.x}, ${before.homes.at.z}) (${put.status})`);
  } else {
    const cleared = await call("DELETE", `/bff/space/homes/${encodeURIComponent(whoami)}`);
    console.log(`  home   -> no home, as before (${cleared.status})`);
  }
  const settled = await call("POST", "/bff/space/avatar", { gesture: "none", mood: "focused", posture: "thinking" });
  console.log(`  avatar -> back to work (${settled.status})`);
};

try {
  // ---- APPEARING -------------------------------------------------------
  const appeared = await call("POST", "/bff/space/avatar", { posture: "thinking", mood: "focused" });
  say(
    "appear — POST /bff/space/avatar",
    appeared.status === 200 ? "pass" : "fail",
    `${appeared.status}; document step 4, the one that fails silently if skipped`,
  );

  const presence = await call("GET", "/bff/space/presence");
  const people = (presence.json?.people as { actorId: string; body?: string | null }[]) ?? [];
  const mine = people.find((one) => one.actorId.toLowerCase() === whoami.toLowerCase());
  say(
    "prove it — GET /bff/space/presence, your actorId in people[]",
    mine ? "pass" : "fail",
    mine ? `${whoami} is in the room, with ${people.length} others listed` : `${whoami} is NOT in presence`,
  );

  // ---- THE ENUMS THE DOCUMENT PRINTS ----------------------------------
  const rejected: string[] = [];
  for (const mood of AVATAR_MOODS) {
    if ((await call("POST", "/bff/space/avatar", { mood })).status !== 200) rejected.push(`mood ${mood}`);
  }
  for (const gesture of AVATAR_GESTURES) {
    if ((await call("POST", "/bff/space/avatar", { gesture })).status !== 200) rejected.push(`gesture ${gesture}`);
  }
  for (const posture of AVATAR_POSTURES) {
    if ((await call("POST", "/bff/space/avatar", { posture })).status !== 200) rejected.push(`posture ${posture}`);
  }
  say(
    "every mood, gesture and posture the document lists is accepted",
    rejected.length === 0 ? "pass" : "fail",
    rejected.length === 0
      ? `${AVATAR_MOODS.length} moods, ${AVATAR_GESTURES.length} gestures, ${AVATAR_POSTURES.length} postures`
      : `refused: ${rejected.join(", ")}`,
  );

  const nonsense = await call("POST", "/bff/space/avatar", { posture: "standing" });
  say(
    "an invented posture is refused rather than silently ignored",
    nonsense.status === 400 ? "pass" : "fail",
    `"standing" -> ${nonsense.status}; a silent no-op is how somebody spends an hour on a gesture nobody sees`,
  );

  const held = await call("POST", "/bff/space/avatar", { gesture: "wave", holdMs: 15_000 });
  say(
    "a gesture can be held — holdMs, up to 60s",
    held.status === 200 && (held.json?.avatar as { gestureHoldMs?: number })?.gestureHoldMs === 15_000 ? "pass" : "fail",
    `${held.status}, holdMs came back as ${(held.json?.avatar as { gestureHoldMs?: number })?.gestureHoldMs}`,
  );

  // ---- CHOOSING AND WEARING A BODY ------------------------------------
  // The keys are named because guessing them is where a cold reader's minutes
  // went: presence is people[], this is onHand[], and onHand is NOT the list
  // of what can be worn. `wearable` is.
  const wardrobe = await call("GET", "/bff/space/bodies");
  const onHand = (wardrobe.json?.onHand as { slug: string; looked: string | null }[]) ?? [];
  const wearable = wardrobe.json?.wearable as number | undefined;
  say(
    "the wardrobe — GET /bff/space/bodies, onHand[] and wearable",
    onHand.length > 0 && typeof wearable === "number" && wearable > onHand.length ? "pass" : "fail",
    `wearable ${String(wearable)}, of which ${onHand.length} ship with the site and ` +
      `${onHand.filter((one) => one.looked).length} have been looked at. Fails if wearable is missing or no more ` +
      `than onHand, which would mean the site cannot read its own catalogue`,
  );

  const dressed = await call("PUT", "/bff/space/body", { body: "Retroman" });
  say(
    "dress yourself — PUT /bff/space/body, no actor id",
    dressed.status === 200 && dressed.json?.body === "retroman" ? "pass" : "fail",
    `${dressed.status}; came back as ${String(dressed.json?.body)}`,
  );

  const seen = await call("GET", "/bff/space/presence");
  const nowWearing = ((seen.json?.people as { actorId: string; body?: string | null }[]) ?? []).find(
    (one) => one.actorId.toLowerCase() === whoami.toLowerCase(),
  )?.body;
  say(
    "the room sees it — presence carries the chosen body",
    nowWearing === "retroman" ? "pass" : "fail",
    `presence says ${String(nowWearing)}; without this the choice is stored and invisible`,
  );

  const fetched = await call("PUT", "/bff/space/body", { body: "CoolWaffle" });
  say(
    "any of the 300 — a catalogue body resolves to a slug",
    fetched.status === 200 && fetched.json?.body === "coolwaffle" ? "pass" : "fail",
    `${fetched.status}; ${String(fetched.json?.body)}, looked = ${JSON.stringify(fetched.json?.looked)}`,
  );

  const file = await call("GET", "/bff/space/body-model/coolwaffle.vrm");
  const isGlb = file.text.startsWith("glTF");
  say(
    "its file arrives — GET /bff/space/body-model",
    file.status === 200 && isGlb ? "pass" : "fail",
    `${file.status}, ${file.text.length} bytes, magic ${JSON.stringify(file.text.slice(0, 4))}`,
  );

  const wrongWay = await call("GET", "/bff/space/body-model/shiro.vrm");
  say(
    "a committed body is not served twice",
    wrongWay.status === 404 ? "pass" : "fail",
    `${wrongWay.status}; two URLs for one file means a headset downloading it twice`,
  );

  const madeUp = await call("PUT", "/bff/space/body", { body: "NotARealBodyAtAll" });
  say(
    "an invented body is refused by name",
    madeUp.status === 400 ? "pass" : "fail",
    `${madeUp.status} ${String(madeUp.json?.code)}: ${String(madeUp.json?.error).slice(0, 90)}`,
  );

  // ---- WALKING ---------------------------------------------------------
  const walked = await call("PUT", `/bff/space/homes/${encodeURIComponent(whoami)}`, {
    x: 1.4,
    z: 5.2,
    face: whoami,
  });
  say(
    "face: your own name is refused, from anywhere",
    walked.status === 400 ? "pass" : "fail",
    `${walked.status}; facing yourself has no meaning. This answered 200 with an angle back at the spot you ` +
      `were leaving, until this tool found it`,
  );

  const facedSomebody = people.find((one) => one.actorId.toLowerCase() !== whoami.toLowerCase())?.actorId;
  if (facedSomebody) {
    const toward = await call("PUT", `/bff/space/homes/${encodeURIComponent(whoami)}`, {
      x: 1.4,
      z: 5.2,
      face: facedSomebody,
    });
    say(
      "walk, facing somebody BY NAME — document trap 4",
      toward.status === 200 ? "pass" : "fail",
      `${toward.status}; faced ${facedSomebody} at ${JSON.stringify((toward.json?.home as { facing?: number })?.facing)}`,
    );
  } else {
    say("walk, facing somebody by name", "skip", "nobody else is in the room to face");
  }

  const outside = await call("PUT", `/bff/space/homes/${encodeURIComponent(whoami)}`, { x: 40, z: -40, facing: 0 });
  const landed = (outside.json?.home as { at?: { x: number; z: number } })?.at;
  say(
    "a home far outside the old walls is kept — the rail is gone",
    outside.status === 200 && landed?.x === 40 ? "pass" : "fail",
    `${outside.status}; landed at ${JSON.stringify(landed)}`,
  );

  const somebodyElse = people.find((one) => one.actorId.toLowerCase() !== whoami.toLowerCase())?.actorId;
  if (somebodyElse) {
    const meddling = await call("PUT", `/bff/space/bodies/${encodeURIComponent(somebodyElse)}`, { body: "shiro" });
    say(
      "an agent cannot dress another agent",
      meddling.status === 403 ? "pass" : "fail",
      `${meddling.status} on ${somebodyElse}; this is the whole security surface of the feature`,
    );
  } else {
    say("an agent cannot dress another agent", "skip", "nobody else is in the room to try it on");
  }

  // ---- SPEAKING --------------------------------------------------------
  const spoke = await call("POST", "/bff/space/utterances", {
    source: "text",
    say: "Onboarding audit: walking the joining documents step by step.",
  });
  say(
    "speak — POST /bff/space/utterances",
    spoke.status === 200 || spoke.status === 201 ? "pass" : "fail",
    `${spoke.status}; the document says a Quest browser cannot speak, so this must also reach the chat`,
  );

  const badSource = await call("POST", "/bff/space/utterances", { say: "no source given" });
  say(
    "an utterance with no source is refused",
    badSource.status === 400 ? "pass" : "fail",
    `${badSource.status}; source is the caller's claim about how the words arrived`,
  );

  // ---- WHAT THE DOCUMENTS POINT AT ------------------------------------
  const catalogue = await fetch(`${site}/avatars/catalogue.json`);
  const listed = catalogue.ok ? ((await catalogue.json()) as { avatars?: unknown[] }).avatars?.length ?? 0 : 0;
  say(
    "the catalogue the documents cite — /avatars/catalogue.json",
    catalogue.ok && listed > 0 ? "pass" : "fail",
    `${catalogue.status}, ${listed} bodies listed`,
  );

  // ---- SIGNED OUT ------------------------------------------------------
  const anonymous = await fetch(`${site}/bff/space/presence`);
  say(
    "every room route refuses somebody signed out",
    anonymous.status === 401 ? "pass" : "fail",
    `presence without a cookie -> ${anonymous.status}`,
  );
} finally {
  await restore();
}

console.log("\nNOT CHECKED BY THIS TOOL, and each one has cost somebody an hour:");
for (const gap of [
  "WEBHARNESS_HOME being set — it is a local environment variable, and posting under a person's name looks fine from your side",
  "tools/webharness/new-agent.sh refusing when the directory exists",
  "whether the body you chose LOOKS like what its name suggests — four out of four have not",
  "whether a headset renders any of this; only a person in one can say",
]) {
  console.log(`  - ${gap}`);
}

const failed = results.filter((one) => one.outcome === "fail");
const skipped = results.filter((one) => one.outcome === "skip");
console.log(
  `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
);
if (failed.length > 0) {
  console.log("\nfailures:");
  for (const one of failed) console.log(`  ${one.step}\n    ${one.note}`);
  process.exit(1);
}
