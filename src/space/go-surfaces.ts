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
  grain: "wood" | "stone" | "rock";
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
  /**
   * The bowls the stones are kept in. Baiwei: "red-clay bowls with the stone
   * tabletop and Longquan celadon bowls with bamboo" — unglazed earth beside
   * the grey slab, a pale green-blue glaze beside the warm wood.
   */
  bowl: {
    body: string;
    rim: string;
    roughness: number;
    clearcoat: number;
    /**
     * The carving in the bowl's side, as a relief (a bump map, not paint).
     * "Add subtle carved classical relief patterns to both bowl styles": lotus
     * petals are the classic carving on Longquan celadon; a fret (key) band on
     * the red clay.
     */
    relief: "lotus" | "fret" | "scroll";
    /**
     * Painted decoration, for a glaze that is PAINTED rather than carved:
     * Jingdezhen blue-and-white is cobalt brushed under a clear glaze. The
     * colour of the brushwork; the relief then names its pattern.
     */
    paint?: string;
  };
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
    // Longquan celadon: a thick, glossy, pale green-blue glaze.
    bowl: { body: "#9dbcaa", rim: "#b9d2c4", roughness: 0.18, clearcoat: 0.9, relief: "lotus" },
  },
  // Lumenfold's spec: slab #777B7D, carved grid #3C4143, bevel #969A9B —
  // "starting values, not locked finals", to be tuned for Baiwei's eye
  // comfort. The bevel is theirs. Then Baiwei, in a headset: "slightly
  // darker", and then "could be still darker": two steps down, to #626668,
  // with everything drawn on it taken down too, to the contrast
  // go-surfaces.test.ts holds — the lines are what a player aims by. THIS IS
  // AS DARK AS A DARK GRID GOES: any darker slab and near-black lines fall
  // under 3:1, so going further means light, inlaid lines instead.
  stone: {
    label: "STONE",
    grain: "stone",
    base: "#626668",
    roughness: 0.82,
    clearcoat: 0.04,
    rim: "#414547",
    rimCarrying: "#8a96a3",
    lines: "#121416",
    lineLight: "#969a9b",
    ink: "#0f1113",
    inkSoft: "#1c1f21",
    // Red clay, as Yixing ware: unglazed, warm and matte.
    bowl: { body: "#8f4630", rim: "#a85a40", roughness: 0.78, clearcoat: 0.05, relief: "fret" },
  },
  /**
   * SCHOLAR'S ROCK (card saha-ing-82be26cf, Lumenfold for Baiwei and Nikk): a
   * dark, weathered gongshi slab, "subdued charcoal/blue-black stone", with
   * Jingdezhen porcelain bowls. Dark enough to read as rock, light enough that
   * a black stone still stands out from it as well as white does on bamboo
   * (go-surfaces.test); so the grid and the writing go light.
   */
  rock: {
    label: "ROCK",
    grain: "rock",
    base: "#454c55",
    roughness: 0.86,
    clearcoat: 0.03,
    rim: "#3a4048",
    rimCarrying: "#6f8196",
    lines: "#b7bec6",
    lineLight: null,
    ink: "#d4d9de",
    inkSoft: "#a3aab2",
    // Jingdezhen blue-and-white: white porcelain, cobalt scrolls under a soft glaze.
    bowl: { body: "#eef1f3", rim: "#2f4f98", roughness: 0.3, clearcoat: 0.55, relief: "scroll", paint: "#2a4a9a" },
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
