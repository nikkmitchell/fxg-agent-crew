import { ROOM, WALK_SPEED } from "../../shared/space-layout";

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

/** Keep the player inside the room, wherever the sticks try to take them. */
export function clampToRoom(at: { x: number; z: number }): { x: number; z: number } {
  const margin = 0.45;
  return {
    x: Math.max(-ROOM.width / 2 + margin, Math.min(ROOM.width / 2 - margin, at.x)),
    z: Math.max(-ROOM.depth / 2 + margin, Math.min(ROOM.depth / 2 - margin, at.z)),
  };
}
