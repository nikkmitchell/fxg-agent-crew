import { WALK_SPEED, clampToWorld } from "../../shared/space-layout";

/**
 * Headset comfort settings, and the room's walls.
 *
 * DELIBERATELY FREE OF ANY XR IMPORT. `SpacePanel` holds this state and is in
 * the main bundle; the moment it imported anything from @react-three/xr the
 * main chunk went from 267 KB to 709 KB, because the lazy boundary only covers
 * what is behind `lazy()`. Keeping the plain data here and the XR code behind
 * the boundary is what makes that measurable claim stay true.
 */

export type Comfort = {
  /**
   * Smooth stick movement is what Nikk asked for and it makes some people ill —
   * including people who are fine with everything else. Snap turning is the
   * single most effective mitigation, so it is the DEFAULT even though smooth
   * was the stated preference: the setting is one click away, and a first
   * session that makes somebody sick is not a setting they get to change.
   */
  turn: "snap" | "smooth";
  /** Degrees per snap. 30 is the usual comfortable step. */
  snapDegrees: number;
  /** Metres per second. Matches the speed everyone else walks at. */
  speed: number;
};

export const DEFAULT_COMFORT: Comfort = {
  turn: "snap",
  snapDegrees: 30,
  speed: WALK_SPEED,
};

/**
 * Keep the player's position a usable NUMBER, wherever the sticks take them.
 *
 * It used to keep them inside the room. Nikk: "remove the limited walking
 * boundary we don't want to have any limit to walking" — so the rail is gone,
 * and what is left is the arithmetic bound ten kilometres out. See WORLD in
 * shared/space-layout.ts for why any bound still exists.
 *
 * The NAME is unchanged deliberately: every caller uses it to mean "make this
 * walked-to position safe to send", and that is still exactly what it does.
 */
export function clampToRoom(at: { x: number; z: number }): { x: number; z: number } {
  const { x, z } = clampToWorld(at);
  return { x, z };
}
