import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bodyKey } from "../../shared/avatar-choice.js";

/**
 * Which names the avatar catalogue knows, so a refusal can say WHY.
 *
 * WHY THE SERVER NEEDS THIS AT ALL. "There is no body by that name" and "that
 * body exists and this site cannot serve its file yet" are different facts,
 * and collapsing them sends somebody hunting for a spelling mistake they did
 * not make. Without the catalogue the server cannot tell them apart.
 *
 * FOUND THE SAME WAY THE UI IS, by searching upward rather than assuming a
 * depth: this file sits at server/ from source and dist-server/server/ when
 * compiled, and the catalogue ships at public/avatars/ in the tree and
 * dist/avatars/ once built. A hardcoded path is right in one of those and
 * silently wrong in the other — exactly the bug findUiRoot exists to avoid.
 *
 * READ ONCE, LAZILY, ON THE FIRST REFUSAL. It is 188KB and only a rejected
 * choice needs it, so nothing is read on a healthy path.
 *
 * A MISSING OR BROKEN FILE IS NOT AN ERROR HERE. It degrades to "the
 * catalogue knows nothing", which means every bad name is answered
 * NO_SUCH_BODY — today's behaviour, and honest, because with no catalogue the
 * server genuinely does not know whether that body exists. Throwing would
 * turn a cosmetic shortfall into a failed request.
 */
const WHERE = ["dist/avatars/catalogue.json", "public/avatars/catalogue.json"];

export function findCatalogue(start: string): string | null {
  for (let dir = start, i = 0; i < 6; i += 1, dir = dirname(dir)) {
    for (const leaf of WHERE) {
      const candidate = resolve(dir, leaf);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Every catalogue name as a `bodyKey`, or an empty set if it cannot be read. */
export function catalogueKeys(path: string | null): Set<string> {
  if (!path) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { avatars?: { name?: unknown }[] };
    const keys = new Set<string>();
    for (const entry of parsed.avatars ?? []) {
      if (typeof entry?.name === "string" && entry.name !== "") keys.add(bodyKey(entry.name));
    }
    return keys;
  } catch {
    return new Set();
  }
}

/**
 * The predicate the body routes take, reading the file at most once.
 *
 * Memoised on the SET rather than on the path, so a machine with no catalogue
 * does not stat the filesystem on every rejected name.
 */
export function knownToTheCatalogue(
  start = dirname(fileURLToPath(import.meta.url)),
): (key: string) => boolean {
  let keys: Set<string> | null = null;
  return (key: string) => {
    keys ??= catalogueKeys(findCatalogue(start));
    return keys.has(key);
  };
}
