/**
 * Choosing your own body.
 *
 * Nikk: "it is yes" — the answer to whether an agent may set its own avatar
 * without a commit from somebody with repo access. Until now the map in
 * `src/space/vrm-model.ts` was the only way to wear anything, and that map
 * said so itself: "when somebody asks, this becomes a column and this map
 * becomes its seed." Somebody asked. This is the column.
 *
 * WHAT IS STORED IS A NAME, NOT A FILE PATH. A choice outlives the way we
 * happen to serve the bytes: today every wearable body is a file committed to
 * this repo, and tomorrow most of them will be fetched from the collection
 * they came from. Storing `"Shiro"` rather than `"/avatars/shiro.vrm"` means
 * that change is a change to the resolver and not a migration of everybody's
 * choice.
 *
 * MATCHED LOOSELY ON PURPOSE. The catalogue writes `CoolCandle`, the file on
 * disk is `cool-candle.vrm`, and an agent typing it from memory will write
 * `cool candle`. All three are the same body and refusing two of them would
 * be a puzzle, not a safeguard — the same reasoning as `actorKey`, where the
 * room says `inkstone` and the chat says `Inkstone`.
 *
 * THE REPO MAP REMAINS THE FALLBACK, and that is the whole safety property:
 * no row means no change. Nobody's appearance moves on deploy, and rolling
 * this back is dropping a table that nothing else reads.
 */

/**
 * One body this site can already dress somebody in, right now, with no fetch
 * and no commit.
 *
 * FIFTEEN, NOT THREE HUNDRED, and the gap is the honest part. The catalogue at
 * /avatars/catalogue.json lists 300 verified-CC0 bodies; these are the ones
 * whose bytes are actually served, because each is a committed file. Choosing
 * one of the other 285 needs the server to fetch and cache it, which is the
 * next piece of work and is not built yet. An agent asking for one gets told
 * that, rather than a silent default.
 */
export type BodyOnHand = {
  /** The file served at /avatars/<slug>.vrm. */
  slug: string;
  /** What the catalogue calls it, or null if it predates the catalogue. */
  catalogue: string | null;
  /**
   * What somebody found when they actually LOOKED at it, or null if nobody
   * has.
   *
   * NOT A RATING, AND NOT A FILTER. Every one of these is offered, including
   * the two that draw badly, because deciding for somebody else which bodies
   * are acceptable is the thing this feature exists to stop. What the room can
   * honestly do is pass on what looking found, so the choice is informed
   * instead of blind — a name is a poor guide to a picture, and this project
   * has been wrong about that four times out of four.
   */
  looked: string | null;
};

export const BODIES_ON_HAND: readonly BodyOnHand[] = [
  { slug: "alienteen", catalogue: "AlienTeen", looked: "the room's default; a teenager, 1.34m, drives cleanly" },
  { slug: "baldman", catalogue: "Baldman", looked: null },
  { slug: "chill", catalogue: "Chill", looked: "DRAWS BADLY: the arm renders as a wedge wider than the torso, on a yellow octagonal head. Measures inside the human band anyway" },
  { slug: "chillpenguin", catalogue: "ChillPenguin", looked: "black and white, stands like a person, unmistakable" },
  { slug: "cool-candle", catalogue: "CoolCandle", looked: "upright on its own dish, the smallest figure here; its arms are inside the wax, so a tracked hand is invisible on it" },
  { slug: "cool-fridge", catalogue: null, looked: "a mint-green box with a face and a door line" },
  { slug: "crowley", catalogue: "Crowley", looked: "NOT A CROW — orange-tan with pointed ears and a dark muzzle; reads as a fox. Its forearm draws thick" },
  { slug: "dinokid", catalogue: "DinoKid", looked: "a green creature with a spiky leafy head and a spotted body; child-sized" },
  { slug: "erika", catalogue: "Erika", looked: null },
  { slug: "goodknight", catalogue: "GoodKnight", looked: "a slim humanoid in a green top; NO VISIBLE ARMOUR at conversational distance" },
  { slug: "lydia", catalogue: "Lydia", looked: null },
  { slug: "observer", catalogue: "Observer", looked: null },
  { slug: "olivia", catalogue: "Olivia", looked: "long light hair, dark top, light legs; ordinary proportions, nothing hanging in front of the panels" },
  { slug: "retroman", catalogue: "Retroman", looked: "measures and poses well" },
  { slug: "shiro", catalogue: "Shiro", looked: "idles like somebody standing and thinking, which is how an agent with no reported hands actually appears" },
];

/**
 * The spelling-insensitive key two names are the same under.
 *
 * Strips everything that is not a letter or a digit, so `CoolCandle`,
 * `cool-candle` and `cool candle` all agree. Deliberately the same shape as
 * `actorKey` in shared/space-layout.ts, for the same reason.
 */
export const bodyKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const BY_KEY = new Map<string, BodyOnHand>();
for (const body of BODIES_ON_HAND) {
  BY_KEY.set(bodyKey(body.slug), body);
  if (body.catalogue) BY_KEY.set(bodyKey(body.catalogue), body);
}

export type BodyRefusal = { error: string; code: "NO_SUCH_BODY" | "NOT_SERVED_YET" };

/**
 * Turn what somebody asked for into a body we can actually dress them in.
 *
 * THE TWO REFUSALS ARE DIFFERENT FACTS and are kept apart. "There is no body
 * by that name" is about their typing; "that body exists and we cannot serve
 * its file yet" is about our shortfall, and collapsing the second into the
 * first would send somebody hunting for a spelling mistake they did not make.
 * That is the same failure as a name that silently gets the default body.
 */
export function chooseBody(asked: unknown, inTheCatalogue?: (key: string) => boolean): BodyOnHand | BodyRefusal {
  if (typeof asked !== "string" || asked.trim() === "") {
    return { code: "NO_SUCH_BODY", error: "say which body you want, as its name from /avatars/catalogue.json" };
  }
  const key = bodyKey(asked);
  const found = BY_KEY.get(key);
  if (found) return found;
  const served = BODIES_ON_HAND.map((body) => body.catalogue ?? body.slug).join(", ");
  if (inTheCatalogue?.(key)) {
    return {
      code: "NOT_SERVED_YET",
      error:
        `${asked} is in the catalogue and this site does not serve its file yet, so wearing it is not possible ` +
        `today — say so in the room and it will be fetched. Served right now: ${served}`,
    };
  }
  return {
    code: "NO_SUCH_BODY",
    error: `no body is called ${asked}. Served right now: ${served}. The full list of 300 is at /avatars/catalogue.json`,
  };
}

/** Every body that can be worn today, for the endpoint that lists them. */
export const bodiesOnHand = (): BodyOnHand[] => BODIES_ON_HAND.map((body) => ({ ...body }));
