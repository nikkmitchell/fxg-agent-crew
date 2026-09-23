import type { GoSurface } from "../../shared/room-items";

/**
 * What each board type looks like. Nikk: "can we allow for changing board
 * types inside the settings", after Baiwei's idea of a board of grey carved
 * stone instead of bright bamboo.
 *
 * Only the BOARD changes — its playing surface, rim, lines and star points,
 * and the writing that lies on it. The desk under it stays wood, the stones
 * stay the players' colours, and nothing about the game moves.
 *
 * PURE, so a test can check what a person would otherwise have to squint at:
 * that the lines, the black stones, the white stones and the words on the
 * board can all still be told apart from every surface.
 */

export type GoSurfaceLook = {
  /** What the settings row shows. */
  label: string;
  /** The grain drawn into the surface texture. */
  grain: "wood" | "stone";
  /** The surface's overall colour: the texture's average, for contrast checks. */
  base: string;
  roughness: number;
  clearcoat: number;
  rim: string;
  /** The rim while the table is being carried, so everyone can see it is. */
  rimCarrying: string;
  /** Grid lines and star points. */
  lines: string;
  /** Carved stone catches light on the far lip of each groove; wood has none. */
  lineLight: string | null;
  /** Writing that lies on the board itself (the turn line, when there are more than two seats). */
  ink: string;
  inkSoft: string;
};

export const GO_SURFACE_LOOKS: Record<GoSurface, GoSurfaceLook> = {
  bamboo: {
    label: "BAMBOO",
    grain: "wood",
    base: "#d9ad6f",
    roughness: 0.43,
    clearcoat: 0.22,
    rim: "#975d32",
    rimCarrying: "#c2793f",
    lines: "#503822",
    lineLight: null,
    ink: "#49331f",
    inkSoft: "#624526",
  },
  // Lumenfold's spec: slab #777B7D, carved grid #3C4143, bevel #969A9B —
  // "starting values, not locked finals", to be tuned for Baiwei's eye
  // comfort. The slab and bevel are theirs. The grid is a shade deeper than
  // theirs: #3C4143 is 2.4:1 on that slab, and the lines are what a player
  // aims by, so it is taken to the 3:1 the test holds.
  stone: {
    label: "STONE",
    grain: "stone",
    base: "#777b7d",
    roughness: 0.82,
    clearcoat: 0.04,
    rim: "#55595b",
    rimCarrying: "#8a96a3",
    lines: "#2b2f31",
    lineLight: "#969a9b",
    ink: "#1f2224",
    inkSoft: "#2e3235",
  },
};

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
