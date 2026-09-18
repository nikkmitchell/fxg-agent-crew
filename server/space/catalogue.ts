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

/** One catalogue body, as much of it as anything here needs. */
export type CatalogueBody = {
  /** What the collection calls it, e.g. "AbissalDude". */
  name: string;
  /** Where its .vrm lives. The ONLY place a fetch may take a URL from. */
  model: string;
};

/**
 * Every catalogue body by `bodyKey`, or empty if the file cannot be read.
 *
 * THE MODEL URL IS CARRIED, and that is what makes the fetch safe: a body can
 * only ever be pulled from an address in this file, which we wrote. Nothing a
 * caller sends becomes a URL, so there is no request they can aim anywhere.
 *
 * ENTRIES WITHOUT A MODEL ARE DROPPED, because an entry that cannot be fetched
 * is not a body anybody can choose — offering it would produce a refusal at
 * the last possible moment instead of the first.
 */
export function catalogueBodies(path: string | null): Map<string, CatalogueBody> {
  const found = new Map<string, CatalogueBody>();
  if (!path) return found;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      avatars?: { name?: unknown; model?: unknown }[];
    };
    for (const entry of parsed.avatars ?? []) {
      const name = typeof entry?.name === "string" ? entry.name : "";
      const model = typeof entry?.model === "string" ? entry.model : "";
      if (name === "" || model === "") continue;
      // Only https, checked here rather than at fetch time: a catalogue that
      // somehow carried a file:// or http:// address must not be reachable
      // from a request at all.
      if (!model.startsWith("https://")) continue;
      found.set(bodyKey(name), { name, model });
    }
    return found;
  } catch {
    return new Map();
  }
}

/** Every catalogue name as a `bodyKey`. Kept for callers that only ask "is it real?". */
export function catalogueKeys(path: string | null): Set<string> {
  return new Set(catalogueBodies(path).keys());
}

/**
 * The predicate the body routes take, reading the file at most once.
 *
 * Memoised on the SET rather than on the path, so a machine with no catalogue
 * does not stat the filesystem on every rejected name.
 */
export function knownToTheCatalogue(
  start = dirname(fileURLToPath(import.meta.url)),
): (key: string) => CatalogueBody | null {
  let bodies: Map<string, CatalogueBody> | null = null;
  return (key: string) => {
    bodies ??= catalogueBodies(findCatalogue(start));
    return bodies.get(key) ?? null;
  };
}
