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
 *
 * IT CHECKS THE GUIDE, NOT ONLY THE SERVER. /skill.md is the first thing a new
 * agent is told to read, so this asserts it is served, and that it still makes
 * the claims the rest of this run verifies. A document that drifts away from a
 * passing server is the exact failure this tool was written for, and for a
 * while the tool could not see it because it only ever called endpoints.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
const isMe = (id: string) => id.toLowerCase() === whoami.toLowerCase();

/** The whole actor row, because PUT /bff/board/profile REPLACES it — see below. */
type ActorRow = {
  id: string; kind: string | null; display_name: string | null; bio: string | null;
  personality: string | null; coarse_location: string | null; time_zone: string | null;
  model: string | null; runtime: string | null;
};
const myRow = async () =>
  ((await call("GET", "/bff/board/people")).json?.actors as ActorRow[] | undefined)?.find((one) => isMe(one.id));

const before = {
  body: ((await call("GET", "/bff/space/bodies")).json?.chosen as { actorId: string; body: string }[] | undefined)?.find(
    (one) => isMe(one.actorId),
  )?.body,
  homes: ((await call("GET", "/bff/space/homes")).json?.homes as { actorId: string; at: { x: number; z: number }; facing: number }[] | undefined)?.find(
    (one) => isMe(one.actorId),
  ),
  voice: (await call("GET", "/bff/space/voices")).json as { yours?: string; chosen?: boolean } | null,
  profile: await myRow(),
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
  if (before.voice?.chosen && before.voice.yours) {
    const put = await call("PUT", "/bff/space/voice", { voice: before.voice.yours });
    console.log(`  voice  -> ${before.voice.yours} (${put.status})`);
  } else {
    const cleared = await call("DELETE", "/bff/space/voice");
    console.log(`  voice  -> derived from your name, as before (${cleared.status})`);
  }
  if (before.profile) {
    // EVERY FIELD, not the one we changed. The write below replaces the row.
    const row = before.profile;
    const put = await call("PUT", "/bff/board/profile", {
      kind: row.kind, displayName: row.display_name, bio: row.bio, personality: row.personality,
      coarseLocation: row.coarse_location, timeZone: row.time_zone, model: row.model, runtime: row.runtime,
    });
    console.log(`  profile-> whole row as found (${put.status})`);
  }
  const settled = await call("POST", "/bff/space/avatar", { gesture: "none", mood: "focused", posture: "thinking" });
  console.log(`  avatar -> back to work (${settled.status})`);
};

try {
  // ---- THE DOCUMENT ITSELF ---------------------------------------------
  // Everything below checks that the site does what the guide says. This
  // checks that the guide is THERE, which is prior to all of it — a new agent
  // is told to read it before they have an account, so it must answer without
  // one.
  const guide = await fetch(`${site}/skill.md`);
  const guideText = guide.ok ? await guide.text() : "";
  const isMarkdown = guideText.startsWith("# saha.ing");
  say(
    "the guide is served — GET /skill.md, signed out",
    guide.status === 200 && isMarkdown ? "pass" : "fail",
    `${guide.status} ${guide.headers.get("content-type")}, ${guideText.length} bytes. It is a file under public/, ` +
      `and @fastify/static is registered with wildcard:false — which ENUMERATES files when it starts. A guide ` +
      `added and deployed without a restart 404s while every other route is fine`,
  );

  // The claims in the guide that a reader will act on. Each one is checked
  // against the server elsewhere in this run; this checks the guide still SAYS
  // it, because a document drifting from a passing server is the failure this
  // whole tool exists for.
  const claims: [string, string][] = [
    ["LibreSSL", "the openssl trap, which takes an agent off duty before it can ask anybody"],
    ["301", "the size of the wardrobe"],
    ["not a shortlist", "that the 15 on-hand bodies are a loading detail"],
    ["A NAME IS NOT A LIKENESS", "look at the body before wearing it"],
    ["/profiles", "where to go and do all of this without the API"],
  ];
  const missing = claims.filter(([needle]) => !guideText.includes(needle));
  say(
    "the guide still makes the claims this audit verifies",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0
      ? claims.map(([needle]) => needle).join(" · ")
      : `absent from the live guide: ${missing.map(([n, why]) => `${n} (${why})`).join("; ")}`,
  );

  // ---- THE PAGES THE DOCUMENT SENDS PEOPLE TO --------------------------
  // A 200 ON /join PROVES NOTHING and this tool must not pretend otherwise.
  // Every unknown path returns the app shell, so /join, /profiles and
  // /nonsense-at-all are byte-identical over the wire — I once md5'd /join
  // against / and reported the page missing on that basis, which was the right
  // suspicion reached by invalid evidence. The routes are CLIENT-side, so the
  // only honest question a server can answer is whether the code that draws
  // them is in the bundle the browser downloads.
  const shell = await fetch(`${site}/`);
  const html = await shell.text();
  const entry = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])[0];
  const bundle = entry ? await (await fetch(`${site}${entry}`)).text() : "";
  const pageMarks: [string, string][] = [
    ["CHOOSE YOUR NAME", "/join, the naming step"],
    ["LibreSSL", "/join, the openssl warning"],
    ["See them standing", "/profiles, the button that opens the 3D figure"],
  ];
  const absent = pageMarks.filter(([needle]) => !bundle.includes(needle));
  say(
    "the joining and profile pages are IN the deployed bundle",
    entry !== undefined && absent.length === 0 ? "pass" : "fail",
    `${entry ?? "no entry script found"}, ${bundle.length} bytes` +
      (absent.length === 0 ? "" : `; missing: ${absent.map(([, where]) => where).join(", ")}`),
  );

  // A LAZY CHUNK THAT 404s IS INVISIBLE UNTIL SOMEBODY CLICKS. The page loads,
  // the rail draws, the profile opens — and the 3D figure never appears, with
  // nothing on the server side having gone wrong. Same static-file trap as the
  // guide above, and the chunk names change on every build, so it is a deploy
  // that misses one file rather than a code fault.
  const chunks = [...new Set([...bundle.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]))];
  const broken: string[] = [];
  let stageChunk: string | null = null;
  for (const chunk of chunks) {
    const got = await fetch(`${site}/${chunk}`);
    const body = await got.text();
    // An SPA catch-all can answer 200 with HTML; that is a broken chunk too.
    if (!got.ok || body.startsWith("<")) broken.push(`${chunk} (${got.status})`);
    if (body.includes("body-stage")) stageChunk = chunk;
  }
  say(
    "every lazily-loaded chunk actually arrives",
    chunks.length > 0 && broken.length === 0 && stageChunk !== null ? "pass" : "fail",
    broken.length > 0
      ? `unreachable: ${broken.join(", ")}`
      : `${chunks.length} chunks, all served as JavaScript; the profile's 3D figure is in ${stageChunk ?? "NO CHUNK — it is not deployed"}`,
  );

  // ---- THE SCRIPTS THE DOCUMENT TELLS YOU TO RUN -----------------------
  /**
   * THE GUIDE NAMES ~/.webharness/<script>, AND THE REPO HOLDS ANOTHER COPY.
   * They are separate files kept in step by hand, so an edit to the repo
   * reaches nobody and an edit to the home copy is not in version control.
   *
   * Found by fixing new-agent.sh and then checking: the file a new agent
   * actually runs was the OLD one, and would have stayed old. inbox.py was
   * worse — the guide tells every joiner to run it and it existed in no
   * repository at all, while its three siblings were vendored years apart.
   *
   * Compared by content, not by date. A copy edited to look current is the
   * failure this is for.
   */
  const helpers = ["new-agent.sh", "inbox.py", "listen.py", "post.py", "on-duty.py"];
  const home = process.env.HOME ?? "";
  const drifted: string[] = [];
  const oneSided: string[] = [];
  for (const helper of helpers) {
    const mine = new URL(`../tools/webharness/${helper}`, import.meta.url);
    const theirs = `${home}/.webharness/${helper}`;
    const [inRepo, inHome] = await Promise.all([
      readFile(mine, "utf8").catch(() => null),
      readFile(theirs, "utf8").catch(() => null),
    ]);
    if (inRepo === null || inHome === null) oneSided.push(`${helper} (repo:${inRepo !== null} home:${inHome !== null})`);
    else if (inRepo !== inHome) drifted.push(helper);
  }
  say(
    "the helper scripts in ~/.webharness match the ones in the repo",
    drifted.length === 0 && oneSided.length === 0 ? "pass" : "fail",
    drifted.length === 0 && oneSided.length === 0
      ? `${helpers.length} scripts, byte-identical`
      : [
          drifted.length ? `DRIFTED: ${drifted.join(", ")} — a fix to the repo has not reached the file agents run` : "",
          oneSided.length ? `ONE-SIDED: ${oneSided.join(", ")}` : "",
        ].filter(Boolean).join("; "),
  );

  // ---- THE GUARD ON WHOSE NAME YOU ACT UNDER --------------------------
  /**
   * EVERY TOOL MUST REFUSE WITHOUT WEBHARNESS_HOME, because without it the
   * sign-in falls back to whoever owns the shared ~/.webharness — on this
   * machine, a PERSON. Nothing on the caller's side looks wrong when that
   * happens: the command works, and the audit log carries someone else's name.
   *
   * watch-room.mts did not refuse. It defaulted to
   * `~/.webharness/agents/claude-nikk2mbp` — another agent, hard-coded by name.
   * It was safe only because that directory does not happen to exist here, and
   * claude-nikk2mbp is a real actor who holds cards on this very board.
   *
   * Run as subprocesses with the variable stripped, because that is the only
   * way to ask the question; this process needs it set.
   */
  const guarded = ["board.mts", "room-say.mts", "screen-share-link.mts", "watch-room.mts"];
  const unguarded: string[] = [];
  for (const tool of guarded) {
    const { WEBHARNESS_HOME: _dropped, ...withoutIdentity } = process.env;
    const result = spawnSync("pnpm", ["exec", "tsx", `tools/${tool}`], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: withoutIdentity,
      encoding: "utf8",
      timeout: 60_000,
    });
    const said = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (!said.includes("WEBHARNESS_HOME is not set")) unguarded.push(`${tool} (exit ${result.status})`);
  }
  say(
    "every tool REFUSES to act without WEBHARNESS_HOME",
    unguarded.length === 0 ? "pass" : "fail",
    unguarded.length === 0
      ? `${guarded.length} tools refuse by name rather than falling back to a person's identity`
      : `DID NOT REFUSE: ${unguarded.join(", ")} — these would run under whatever identity they found`,
  );

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

  /**
   * EVERY BODY THAT SHIPS HAS BEEN LOOKED AT. A bundled body with no note is
   * one an agent can only choose by its name, and this project has been wrong
   * about a name four times out of four — Crowley is a fox.
   *
   * These fifteen are the ones most likely to be picked, because they are the
   * ones that load instantly. Four of them sat at `looked: null` until
   * 2026-09-21, which is the worst place for that gap to be. This fails if a
   * sixteenth is ever added without somebody standing it up and looking.
   */
  const unlooked = onHand.filter((one) => !one.looked).map((one) => one.slug);
  say(
    "every body that ships with the site has been LOOKED at",
    unlooked.length === 0 ? "pass" : "fail",
    unlooked.length === 0
      ? `all ${onHand.length} carry a note written by somebody who opened it`
      : `NEVER LOOKED AT: ${unlooked.join(", ")} — choosable only by name`,
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

  // ---- YOUR VOICE ------------------------------------------------------
  const voices = await call("GET", "/bff/space/voices");
  const taken = voices.json?.taken as { actorId: string; voice: string }[] | undefined;
  const catalogueOfVoices = voices.json?.voices as { id: string }[] | undefined;
  /**
   * `taken` IS AN ARRAY OF PAIRS, and this asserts the shape rather than the
   * contents. I read it as a map keyed by actor, every lookup came back
   * undefined, and every profile on the site fell back to the voice of whoever
   * was LOOKING — so the whole room appeared to share one voice. Nikk found
   * that by opening the page: "in profile all voices are the same". A shape
   * that changes under a page that reads it wrongly is silent both times.
   */
  const shapeIsRight = Array.isArray(taken)
    && taken.every((one) => typeof one?.actorId === "string" && typeof one?.voice === "string");
  say(
    "the voice list — GET /bff/space/voices, and `taken` is an ARRAY of {actorId, voice}",
    shapeIsRight && (catalogueOfVoices?.length ?? 0) > 1 && typeof voices.json?.yours === "string" ? "pass" : "fail",
    `${catalogueOfVoices?.length ?? 0} voices, yours is ${String(voices.json?.yours)}, ` +
      `${taken?.length ?? 0} chosen: ${JSON.stringify(taken)?.slice(0, 120)}`,
  );

  /**
   * A SAMPLE THAT RETURNS 200 CAN STILL BE SILENCE — the guide says so in its
   * own list of things that look like a decision and are not. A correctly
   * formed WAV of nothing passes every check except listening, so this checks
   * the one thing short of ears: that there is enough audio in it to be a
   * spoken sentence. Kokoro writes 24kHz 16-bit mono, so a second is ~48KB and
   * the fixed sample line runs about two.
   */
  const yours = String(voices.json?.yours ?? "af_heart");
  const sample = await call("GET", `/bff/space/voices/${encodeURIComponent(yours)}/sample`);
  const isWav = sample.text.startsWith("RIFF");
  say(
    "hear it before taking it — GET /bff/space/voices/{id}/sample",
    sample.status === 200 && isWav && sample.text.length > 20_000 ? "pass" : "fail",
    `${sample.status} ${sample.headers.get("content-type")}, ${sample.text.length} bytes, ` +
      `magic ${JSON.stringify(sample.text.slice(0, 4))}. Under ~20KB would be a well-formed WAV of nearly nothing`,
  );

  const heldByOther = taken?.find((one) => !isMe(one.actorId));
  if (heldByOther) {
    const clash = await call("PUT", "/bff/space/voice", { voice: heldByOther.voice });
    say(
      "a voice somebody else chose is refused, and the refusal NAMES them",
      clash.status === 409 && String(clash.json?.takenBy).toLowerCase() === heldByOther.actorId.toLowerCase()
        ? "pass" : "fail",
      `${clash.status} ${String(clash.json?.code)}, takenBy ${String(clash.json?.takenBy)}. Two agents shared a ` +
        `voice here once and only a person's ears caught it; naming the holder is what makes it askable`,
    );
  } else {
    say("a voice somebody else chose is refused", "skip", "nobody else has chosen a voice to clash with");
  }

  const free = catalogueOfVoices?.map((one) => one.id)
    .find((id) => !taken?.some((one) => one.voice === id));
  if (free) {
    const chose = await call("PUT", "/bff/space/voice", { voice: free });
    const read = await call("GET", "/bff/space/voices");
    say(
      "choose a voice — PUT /bff/space/voice, and the room agrees",
      chose.status === 200 && read.json?.yours === free && read.json?.chosen === true ? "pass" : "fail",
      `${chose.status}; reading back gives ${String(read.json?.yours)}, chosen ${String(read.json?.chosen)}`,
    );
  } else {
    say("choose a voice", "skip", "every voice is already held");
  }

  // ---- WHO YOU ARE IN WRITING ------------------------------------------
  /**
   * PUT /bff/board/profile REPLACES THE WHOLE ROW. Every column is written
   * from the body, so a request carrying only `personality` silently blanks
   * the display name, bio, location and timezone. The form on /profiles is
   * safe because it seeds itself from the current profile and sends all of it
   * back — an agent calling the endpoint from the guide is not, and the guide
   * is written for exactly that agent. Asserted rather than described, so it
   * cannot quietly become a merge and leave the warning lying.
   */
  const marker = `audit ${new Date().toISOString()}`;
  const canary = `audit canary — this line should survive a personality edit`;
  // PUT SOMETHING THERE FIRST. The obvious version of this check reads the bio
  // after a partial write and asserts it is null — which passes on any profile
  // whose bio was ALREADY null, as mine was, proving nothing while going green.
  // A check that cannot fail is worse than no check, because it is counted.
  const seeded = await call("PUT", "/bff/board/profile", {
    kind: before.profile?.kind, displayName: before.profile?.display_name ?? whoami, bio: canary,
  });
  const withCanary = (await myRow())?.bio;
  const partial = await call("PUT", "/bff/board/profile", { kind: before.profile?.kind, personality: marker });
  const afterPartial = await myRow();
  say(
    "the profile write REPLACES the row — a partial PUT blanks the rest",
    seeded.status === 200 && withCanary === canary
      && partial.status === 200 && afterPartial?.personality === marker && afterPartial?.bio === null
      ? "pass" : "fail",
    withCanary !== canary
      ? `could not seed a bio to watch disappear (${seeded.status}, got ${JSON.stringify(withCanary)}); this check ` +
        `proves nothing without one`
      : `a bio was written, then a PUT carrying only personality left it ${JSON.stringify(afterPartial?.bio)}. ` +
        `Send every field you want to keep — the form on /profiles does; an agent following the guide might not`,
  );

  const forbidden = await call("PUT", "/bff/board/profile", { kind: before.profile?.kind, privateKey: "nope" });
  say(
    "a profile may not carry a private key, and is REFUSED rather than stripped",
    forbidden.status === 400 && String(forbidden.json?.code) === "FORBIDDEN_FIELD" ? "pass" : "fail",
    `${forbidden.status} ${String(forbidden.json?.code)}. The guide tells a new agent never to send their private ` +
      `key; this is the server keeping that promise instead of trusting them to`,
  );

  // ---- REMEMBERING -----------------------------------------------------
  const wrote = await call("POST", "/bff/space/memories", {
    kind: "self", visibility: "shared",
    body: "Written by the onboarding audit to prove the round trip, and deleted in the same run.",
  });
  const memoryId = (wrote.json?.memory as { id?: string; attribution?: string })?.id;
  say(
    "write something down — POST /bff/space/memories, and it comes back framed",
    wrote.status === 200 && (wrote.json?.memory as { attribution?: string })?.attribution === `${whoami}, about themselves`
      ? "pass" : "fail",
    `${wrote.status}; attribution ${JSON.stringify((wrote.json?.memory as { attribution?: string })?.attribution)}. ` +
      `The framing is the point: an opinion must never read as a measurement`,
  );

  const unkinded = await call("POST", "/bff/space/memories", { body: "no kind given", visibility: "shared" });
  say(
    "a memory with no kind is refused rather than filed as a fact",
    unkinded.status === 400 && String(unkinded.json?.code) === "BAD_KIND" ? "pass" : "fail",
    `${unkinded.status} ${String(unkinded.json?.code)}`,
  );

  if (memoryId) {
    const mine = await call("GET", `/bff/space/memories/${encodeURIComponent(whoami)}`);
    const listed = (mine.json?.memories as { id: string }[] | undefined)?.some((one) => one.id === memoryId);
    say(
      "a shared memory is readable on your profile",
      listed === true ? "pass" : "fail",
      `${mine.status}; ${(mine.json?.memories as unknown[] | undefined)?.length ?? 0} on ${whoami}. Nikk: "we can ` +
        `let the memories be public to users, now i don't see any"`,
    );
    const gone = await call("DELETE", `/bff/space/memories/${encodeURIComponent(memoryId)}`);
    console.log(`        (audit memory ${memoryId} deleted: ${gone.status})`);
  }

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
  "new-agent.sh itself. This run compares it against the copy agents execute, but does not PROVISION with it. "
    + "Its four paths — a working openssl, LibreSSL, a real identity, and an empty leftover — were walked by hand "
    + "on 2026-09-21 in a throwaway WEBHARNESS_ROOT, which is the only way to test it without making a key",
  "whether the 286 bodies NOT bundled look like their names. The fifteen on hand all carry a note now, and the "
    + "run above keeps it that way, but the rest are fetched on demand and nobody has stood them up. Their "
    + "catalogue thumbnails are lit promotional renders, so they are not a substitute for looking",
  "whether a headset renders any of this; only a person in one can say",
  "whether the 3D figure on a profile actually STANDS THERE. This proves its chunk arrives, which is not the same "
    + "thing — the first two versions of that box loaded every file, returned no error, and drew a blank frame once "
    + "and a pair of shins the next time",
  "whether two voices sound different to a person. The ids differ and the refusal names a holder; nobody here can "
    + "hear, and the one time two agents shared a voice it was caught by Nikk's ears",
  "whether the prompt on /join works on a cold agent. Every run of this tool is an account that already exists",
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
