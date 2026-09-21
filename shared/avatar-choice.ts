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
 * happen to serve the bytes: fifteen bodies are files committed to this repo,
 * and the rest are fetched from the collection they came from the first time
 * somebody's browser asks. Storing `"Shiro"` rather than `"/avatars/shiro.vrm"`
 * is why that second route arrived as a change to the resolver and not as a
 * migration of everybody's choice.
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
 * FIFTEEN, AND NOT A LIMIT. The catalogue at /avatars/catalogue.json lists
 * 300 verified-CC0 bodies, and any of them can be worn. These fifteen are only
 * the ones whose files are committed here, so they need no fetch. Anything
 * else is pulled from the collection on first use (server/space/body-files.ts).
 * This comment said the fetch was "not built yet" for a day after it was built,
 * which is why the wardrobe's note is now computed rather than written: see
 * describeWardrobe in server/space/bodies.ts.
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
   * LOOKED MEANS THE MODEL, NOT THE THUMBNAIL. The catalogue pictures are lit
   * promotional renders — neon key lights, coloured rims — and every one of the
   * four checked on 2026-09-21 was dramatically more vivid than the body the
   * room actually draws, which is flatter and paler. Judging from the thumbnail
   * is the same mistake as judging from the name, one step further in.
   *
   * These notes cannot speak to HEIGHT. The profile stage scales every figure
   * to a constant height on purpose, so a short body is not a speck beside a
   * tall one; only proportions WITHIN a figure are visible there.
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
  { slug: "baldman", catalogue: "Baldman", looked: "bald and heavily built, with a blue band across the eyes, a striped blue-and-white top and dark shorts; bare arms and legs. A comic-book strongman, not an ordinary man" },
  { slug: "chill", catalogue: "Chill", looked: "DRAWS BADLY: the arm renders as a wedge wider than the torso, on a yellow octagonal head. Measures inside the human band anyway" },
  { slug: "chillpenguin", catalogue: "ChillPenguin", looked: "black and white, stands like a person, unmistakable" },
  { slug: "cool-candle", catalogue: "CoolCandle", looked: "upright on its own dish, the smallest figure here; its arms are inside the wax, so a tracked hand is invisible on it" },
  { slug: "cool-fridge", catalogue: null, looked: "a mint-green box with a face and a door line" },
  { slug: "crowley", catalogue: "Crowley", looked: "NOT A CROW — orange-tan with pointed ears and a dark muzzle; reads as a fox. Its forearm draws thick" },
  { slug: "dinokid", catalogue: "DinoKid", looked: "a green creature with a spiky leafy head and a spotted body; child-sized" },
  { slug: "erika", catalogue: "Erika", looked: "pale lavender hair, olive top, blue-grey trousers; ordinary proportions and plain clothes — the least remarkable figure on hand, which is its own kind of useful" },
  { slug: "goodknight", catalogue: "GoodKnight", looked: "a slim humanoid in a green top; NO VISIBLE ARMOUR at conversational distance" },
  { slug: "lydia", catalogue: "Lydia", looked: "ELONGATED: fashion-illustration proportions, legs far longer than the torso, on heels; dark hair up, lilac top, indigo trousers. A stylised figure rather than a person" },
  { slug: "observer", catalogue: "Observer", looked: "NO FACE AT ALL: a flat black-and-white bullseye for a head and an ink-blot spotted body. Nothing on it can show where it is looking, so gaze reads as nothing" },
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

/** Whether this slug's file ships with the site, rather than being fetched. */
export const isOnHand = (slug: string): boolean => BY_KEY.has(bodyKey(slug));

/**
 * Where the room should load a body from.
 *
 * TWO PLACES, AND THE CLIENT WORKS OUT WHICH FROM THE SLUG ALONE. A body that
 * ships with the site is a static file; one from the catalogue is fetched and
 * cached by the server on first use. Deciding it here means nothing extra has
 * to travel on the wire — the presence snapshot carries a name, and both ends
 * agree what that name means because they read the same list.
 */
export const bodyPath = (slug: string): string =>
  isOnHand(slug) ? `/avatars/${slug}.vrm` : `/bff/space/body-model/${slug}.vrm`;

/**
 * Turn what somebody asked for into a body we can actually dress them in.
 *
 * THE TWO REFUSALS ARE DIFFERENT FACTS and are kept apart. "There is no body
 * by that name" is about their typing; "that body exists and we cannot serve
 * its file" is about our shortfall, and collapsing the second into the first
 * would send somebody hunting for a spelling mistake they did not make. That
 * is the same failure as a name that silently gets the default body.
 *
 * A CATALOGUE BODY IS NOW A REAL ANSWER, not a refusal. When the lookup finds
 * one, its `bodyKey` becomes the slug and the server fetches the file the
 * first time somebody's browser asks for it. NOT_SERVED_YET survives for the
 * case where there is no lookup at all — a machine with no catalogue file
 * genuinely cannot tell whether that name is a body or a typo, and must not
 * guess.
 */
export function chooseBody(
  asked: unknown,
  inTheCatalogue?: (key: string) => { name: string } | null,
): BodyOnHand | BodyRefusal {
  if (typeof asked !== "string" || asked.trim() === "") {
    return { code: "NO_SUCH_BODY", error: "say which body you want, as its name from /avatars/catalogue.json" };
  }
  const key = bodyKey(asked);
  const found = BY_KEY.get(key);
  if (found) return found;
  const fromCatalogue = inTheCatalogue?.(key);
  if (fromCatalogue) {
    // Nobody has looked at it, and saying so is the honest value of the field:
    // a name is a poor guide to a picture and this project has been wrong
    // about that four times out of four.
    return { slug: key, catalogue: fromCatalogue.name, looked: null };
  }
  const served = BODIES_ON_HAND.map((body) => body.catalogue ?? body.slug).join(", ");
  if (!inTheCatalogue) {
    return {
      code: "NOT_SERVED_YET",
      error:
        `this server cannot read the avatar catalogue, so it cannot tell whether ${asked} is a real body. ` +
        `Served without it: ${served}`,
    };
  }
  return {
    code: "NO_SUCH_BODY",
    error: `no body is called ${asked}. The full list of 300 is at /avatars/catalogue.json`,
  };
}

/** The fifteen whose files ship with the site. Not everything that can be worn: see describeWardrobe. */
export const bodiesOnHand = (): BodyOnHand[] => BODIES_ON_HAND.map((body) => ({ ...body }));
