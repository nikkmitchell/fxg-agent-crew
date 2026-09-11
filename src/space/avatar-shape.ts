/**
 * What shape a figure is, and why.
 *
 * Pulled out of the component so the rule can be tested without a renderer.
 * The rule is the same one `src/Identity.tsx` keeps in two dimensions, and it
 * is the only thing in this scene that carries meaning:
 *
 *   circle        human
 *   square        agent
 *   neither       we were never told
 *
 * The third case is the one that matters. Three of the five actors in the live
 * database have never declared a kind, and a room that drew them as people
 * would be making a claim on their behalf. They get an eight-sided body and a
 * broken floor ring — visibly not a circle, visibly not a square.
 */

export type Kind = "human" | "agent" | null;

export type BodySpec =
  /** Radial: a cylinder. `segments` of 24 reads as round, 8 clearly does not. */
  | { shape: "round"; radiusTop: number; radiusBottom: number; segments: number }
  | { shape: "boxy"; width: number; depth: number };

export const BODY_HEIGHT = 1.15;

export function bodySpec(kind: Kind): BodySpec {
  if (kind === "agent") return { shape: "boxy", width: 0.5, depth: 0.36 };
  if (kind === "human") return { shape: "round", radiusTop: 0.26, radiusBottom: 0.3, segments: 24 };
  // Eight sides: a silhouette that is neither a circle nor a square, so the
  // reader cannot mistake an unknown for either answer.
  return { shape: "round", radiusTop: 0.26, radiusBottom: 0.3, segments: 8 };
}

/** Solid for a declared kind, broken for one we were never given. */
export function ringIsBroken(kind: Kind): boolean {
  return kind === null;
}
