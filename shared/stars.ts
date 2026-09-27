/**
 * THE STAR MAP: a sky of faint stars high above the room, the same stars for
 * everyone, where anyone can draw a constellation by joining one star to
 * another. The lines stay, so over days the room's sky fills with shapes that
 * people made together. Joining two already-joined stars takes the line away.
 */

export const STAR_COUNT = 160;
/** The most lines the sky keeps; the oldest fade first. */
export const MOST_LINKS = 300;
/** How high the sky is, and how wide. */
export const SKY = { height: 6.5, radius: 9 } as const;

export type Star = { x: number; y: number; z: number; size: number };
export type StarLink = { a: number; b: number; by: string };
export type StarSky = { links: StarLink[]; revision: number };
export type StarChange = { a: unknown; b: unknown };
export type StarEvent = { kind: "link"; link: StarLink; revision: number; dropped: number } | { kind: "unlink"; a: number; b: number; revision: number };

/** The stars, always the same: spread over a shallow dome by the golden angle, sizes varied. */
export function stars(centre = { x: 0, z: 4 }): Star[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: STAR_COUNT }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / STAR_COUNT) * SKY.radius;
    const a = i * golden;
    const wobble = Math.sin(i * 12.9898) * 43758.5453;
    const jitter = wobble - Math.floor(wobble);
    return {
      x: centre.x + Math.cos(a) * r,
      y: SKY.height + 1.5 * (1 - r / SKY.radius) + jitter * 0.4,
      z: centre.z + Math.sin(a) * r,
      size: 0.03 + (jitter > 0.85 ? 0.05 : jitter * 0.025),
    };
  });
}

export function emptySky(): StarSky {
  return { links: [], revision: 0 };
}

const star = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < STAR_COUNT ? value : null;

export function applyStars(sky: StarSky, change: StarChange, by: string): { sky: StarSky; event: StarEvent } | { refused: string } {
  const a0 = star(change.a);
  const b0 = star(change.b);
  if (a0 === null || b0 === null) return { refused: "No such star." };
  if (a0 === b0) return { refused: "A star cannot be joined to itself." };
  const [a, b] = a0 < b0 ? [a0, b0] : [b0, a0];
  const revision = sky.revision + 1;
  if (sky.links.some((link) => link.a === a && link.b === b)) {
    return { sky: { links: sky.links.filter((link) => !(link.a === a && link.b === b)), revision }, event: { kind: "unlink", a, b, revision } };
  }
  const link: StarLink = { a, b, by };
  const all = [...sky.links, link];
  const dropped = Math.max(0, all.length - MOST_LINKS);
  return { sky: { links: all.slice(dropped), revision }, event: { kind: "link", link, revision, dropped } };
}

export function applyStarEvent(sky: StarSky, event: StarEvent): StarSky | null {
  if (event.revision <= sky.revision) return sky;
  if (event.revision !== sky.revision + 1) return null;
  if (event.kind === "link") return { links: [...sky.links.slice(event.dropped), event.link], revision: event.revision };
  return { links: sky.links.filter((link) => !(link.a === event.a && link.b === event.b)), revision: event.revision };
}

export function parseSky(value: unknown): StarSky | null {
  if (!value || typeof value !== "object") return null;
  const sky = value as Partial<StarSky>;
  return Array.isArray(sky.links) && typeof sky.revision === "number" ? { links: sky.links, revision: sky.revision } : null;
}
