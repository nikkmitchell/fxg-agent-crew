/**
 * Say who comes into and leaves a room, one line each, for an agent that
 * should notice arrivals (Nikk, 2026-09-28: the lobby, where Nightjar greets
 * people). Polls presence every 20 s; prints nothing while nothing changes.
 *
 *   SAHA_ROOM=lobby pnpm exec tsx tools/presence-watch.mts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signIn } from "./saha-session.mts";

/**
 * EVERYONE EVER SEEN HERE, so an arrival can say whether it is somebody's
 * first visit (Nikk, 2026-09-28: welcome everyone, and "if they are new take
 * extra time to onboard them"). Kept beside the agent's own identity.
 */
const seenFile = join(process.env.WEBHARNESS_HOME ?? ".", `seen-in-${process.env.SAHA_ROOM ?? "lobby"}.json`);
const everSeen = new Set<string>(existsSync(seenFile) ? (JSON.parse(readFileSync(seenFile, "utf8")) as string[]) : []);
const remember = (id: string): boolean => {
  const key = id.toLowerCase();
  if (everSeen.has(key)) return false;
  everSeen.add(key);
  writeFileSync(seenFile, JSON.stringify([...everSeen].sort()));
  return true;
};

const room = process.env.SAHA_ROOM ?? "lobby";
/** Sign in, waiting out a proxy or network that is down rather than dying (it flaps). */
async function signInPatiently(): Promise<Awaited<ReturnType<typeof signIn>>> {
  for (let wait = 5_000; ; wait = Math.min(wait * 2, 120_000)) {
    try {
      return await signIn();
    } catch (error) {
      console.log(JSON.stringify({ presence: "trouble", why: `sign-in: ${String(error).split("\n")[0].slice(0, 100)}`, retrying_in: wait / 1000 }));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
let session = await signInPatiently();
let known: Map<string, string> | null = null;
const me = (process.env.WEBHARNESS_HOME ?? "").split("/").pop()?.toLowerCase() ?? "";

for (;;) {
  try {
    const answer = await fetch(`${session.site}/bff/space/presence`, { headers: { cookie: session.cookie } });
    if (answer.status === 401) {
      session = await signInPatiently();
      continue;
    }
    const body = (await answer.json()) as { people?: { actorId: string; connected?: boolean; kind?: string | null }[] };
    const now = new Map<string, string>();
    for (const person of body.people ?? []) {
      if (person.connected && person.actorId.toLowerCase() !== me) now.set(person.actorId, person.kind ?? "unknown");
    }
    if (known) {
      for (const [id, kind] of now) if (!known.has(id)) console.log(JSON.stringify({ presence: "joined", room, who: id, kind, firstVisit: remember(id) }));
      for (const id of known.keys()) if (!now.has(id)) console.log(JSON.stringify({ presence: "left", room, who: id }));
    } else {
      for (const id of now.keys()) remember(id);
      console.log(JSON.stringify({ presence: "watching", room, here: [...now.keys()] }));
    }
    known = now;
  } catch (error) {
    console.log(JSON.stringify({ presence: "trouble", why: String(error).slice(0, 120) }));
  }
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
