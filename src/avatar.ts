/**
 * Deterministic avatar art for a person or an agent.
 *
 * Everything here is derived from a stable actor id, so the same actor is the
 * same picture on every screen and every machine with nobody maintaining a
 * mapping and nothing to store.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 * 1. THE ART CARRIES NO MEANING. Colour and motif say nothing about a person's
 *    role, standing or kind. Anything a reader needs is also written in text.
 *    A picture that encoded status would be a claim the screen cannot prove.
 *
 * 2. THE INITIALS MUST BE READABLE ON WHATEVER THE HASH PICKED. That is not a
 *    matter of taste here — a hash chooses the colours, so no human ever looks
 *    at most of the combinations. The ink is therefore MEASURED against the
 *    background rather than paired with it by eye, and the test asserts the
 *    floor across the whole seed space. I have already published one wrong
 *    contrast figure on this project; measuring is how that stops happening.
 */

const hashSeed = (seed: string): number =>
  [...seed].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0, 2_166_136_261);

/**
 * Base hues. Each is a *background* only; the ink over it is chosen by
 * measurement below, never listed alongside it, so adding a palette here cannot
 * quietly introduce an unreadable pairing.
 */
const PALETTES = [
  { paper: "#e6ddc9", accent: "#3156d8" },
  { paper: "#f0d8cf", accent: "#e45338" },
  { paper: "#dce7d9", accent: "#3d8063" },
  { paper: "#eadfca", accent: "#cf9126" },
  { paper: "#d9e3ef", accent: "#2f5d8c" },
  { paper: "#efd9e4", accent: "#a33d70" },
  { paper: "#dfe0d2", accent: "#5c6b2f" },
  { paper: "#e8dcef", accent: "#6244a8" },
] as const;

const INKS = ["#141517", "#ffffff"] as const;

const channel = (value: number): number =>
  value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** The ink with the most contrast against this background — measured, not chosen. */
export function readableInk(background: string): string {
  return [...INKS].sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0];
}

export type AvatarRecipe = {
  /** Tile background, and the colour the initials sit on. */
  paper: string;
  /** The motif colour. Decoration; nothing reads text off it. */
  accent: string;
  /** Initials colour, measured against `paper`. */
  ink: string;
  motif: number;
  offset: number;
  rotation: number;
  /** How much of the tile the motif covers. Kept low so the initials stay clear. */
  scale: number;
};

export const MOTIF_COUNT = 6;

export function avatarRecipe(seed: string): AvatarRecipe {
  const hash = hashSeed(seed);
  const palette = PALETTES[hash % PALETTES.length];
  return {
    paper: palette.paper,
    accent: palette.accent,
    ink: readableInk(palette.paper),
    motif: (hash >>> 4) % MOTIF_COUNT,
    offset: 10 + ((hash >>> 8) % 22),
    rotation: -20 + ((hash >>> 12) % 41),
    scale: 0.72 + ((hash >>> 18) % 26) / 100,
  };
}

/**
 * Initials for the readable core of the tile.
 *
 * Derived from the real name and nothing else. When a name has no letters or
 * digits at all this returns "?" rather than a plausible-looking guess — the
 * whole reason this component was written was a rail that showed everyone the
 * same invented initials.
 */
export function initialsOf(name: string): string {
  const words = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
