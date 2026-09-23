import { ARC_FOCUS, ROOM, STAND_BACK, STATIONS } from "./space-layout.js";
import type { Placement } from "./space-wire.js";
import type { Vec3 } from "./space-layout.js";

/**
 * Whether a panel may go where somebody just dragged it.
 *
 * SHARED BETWEEN THE BROWSER AND THE SERVER, like the layout and the wire
 * format, and for the same reason: the browser should refuse a drag while it is
 * happening rather than let go and watch the server undo it, and the server
 * cannot trust the browser's refusal. Two implementations of "is this a
 * reasonable place for a board" would eventually disagree, and the way you
 * would find out is a panel that snaps back for one person and not another.
 */

/** How far above the floor a panel's middle may sit. */
export const PANEL_Y = { min: 0.9, max: 3.4 } as const;

/**
 * How much bigger or smaller than its designed size a panel may be made.
 *
 * BOUNDED AT BOTH ENDS, and both bounds are about being able to use the room
 * rather than about taste. Below the floor a panel is a postage stamp with
 * unreadable text, which is indistinguishable from a panel that failed to load.
 * Above the ceiling one panel fills the arc and hides the others behind it,
 * including the ones somebody would need in order to shrink it again.
 */
export const PANEL_SCALE = { min: 0.4, max: 2.5 } as const;

/** The size of a panel nobody has resized. */
export const DEFAULT_SCALE = 1;

/** A placement's size, with the stored-before-resizing-existed case handled. */
export function scaleOf(place: Placement): number {
  return place.scale ?? DEFAULT_SCALE;
}

/**
 * How close to the rail a panel may be pushed.
 *
 * Bigger than the walking margin: a person clamped to the boundary must still
 * be able to stand back far enough to read a panel pushed to the same edge.
 */
const EDGE = 1.6;

export function placementRefusal(place: Placement): string | null {
  if (!(place.id in STATIONS)) return `there is no panel called "${place.id}"`;

  for (const [axis, value] of Object.entries(place.position) as [keyof Vec3, number][]) {
    if (!Number.isFinite(value)) return `that position is not a number (${axis})`;
  }
  if (!Number.isFinite(place.rotationY)) return "that rotation is not a number";

  const halfWidth = ROOM.width / 2 - EDGE;
  const halfDepth = ROOM.depth / 2 - EDGE;
  if (Math.abs(place.position.x) > halfWidth || Math.abs(place.position.z) > halfDepth) {
    return "that is outside the room; nobody would be able to stand back far enough to read it";
  }
  if (place.position.y < PANEL_Y.min) return "that is too low to read without crouching";
  if (place.position.y > PANEL_Y.max) return "that is above where anybody can read it";

  if (place.scale !== undefined) {
    if (!Number.isFinite(place.scale)) return "that size is not a number";
    if (place.scale < PANEL_SCALE.min) {
      return `that is smaller than ${PANEL_SCALE.min} of its normal size; the writing on it would not be readable`;
    }
    if (place.scale > PANEL_SCALE.max) {
      return `that is bigger than ${PANEL_SCALE.max} times its normal size; it would cover the panels behind it`;
    }
  }
  return null;
}

/** The same rotation, wrapped to a single turn, so stored values stay readable. */
export function normaliseRotation(radians: number): number {
  const turn = Math.PI * 2;
  const wrapped = ((radians % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

/** Where a panel hangs when nobody has moved it. */
export function defaultPlacement(id: string): Placement | null {
  const station = STATIONS[id];
  if (!station) return null;
  return { id, position: station.surface.position, rotationY: station.surface.rotationY };
}

/**
 * Which way a panel at (x, z) must be turned to face the middle of the arc.
 *
 * A plane with no rotation faces +z, so its normal is (sin ry, cos ry). To face
 * a point, that normal must BE the direction to it — so `ry = atan2(dx, dz)`
 * and nothing else. I first wrote this with a `+ Math.PI` on the end, dragged a
 * panel across the room and watched it turn its back on everybody; the test
 * below is the one that would have said so.
 */
export function facingArc(x: number, z: number): number {
  return Math.atan2(ARC_FOCUS.x - x, ARC_FOCUS.z - z);
}

/**
 * Which way a panel at (x, z) must be turned to face a given point — the person
 * dragging it, rather than the middle of the arc.
 *
 * Nikk, from the headset: "the panels when you move them left and right
 * they're always facing towards some center point in the scene, but we don't
 * actually have a center point in the scene, so just adjust that with your move
 * and drag system". `facingArc` still describes the room's DEFAULT layout, which
 * really is laid out round that point; a panel somebody has picked up turns to
 * face THEM instead, which is the only reference a moved panel has.
 *
 * Same maths as facingArc — a plane with no rotation faces +z, so `ry =
 * atan2(dx, dz)` — with the point passed in.
 *
 * NULL WHEN THE POINT IS ON TOP OF THE PANEL. Straight overhead the direction is
 * undefined and atan2(0, 0) would snap the panel to face +z for no reason; the
 * caller keeps whatever rotation it already had.
 */
export function facingPoint(x: number, z: number, toward: { x: number; z: number }): number | null {
  const dx = toward.x - x;
  const dz = toward.z - z;
  if (Math.hypot(dx, dz) < 0.05) return null;
  return Math.atan2(dx, dz);
}

/**
 * Where an avatar stands to attend to a panel that may have been moved.
 *
 * Derived from the panel rather than stored beside it, so moving a board moves
 * the place agents walk to in the same motion. The distance is the arc's own
 * `STAND_BACK`, imported rather than repeated: this used to be a local 1.8 with
 * a comment promising it matched, and a promise is not a mechanism.
 */
export function standFor(place: Placement): Vec3 {
  // A panel with no rotation faces +z, so its normal is (sin ry, cos ry) and
  // the place to stand is that far along it.
  return {
    x: place.position.x + Math.sin(place.rotationY) * STAND_BACK,
    y: 0,
    z: place.position.z + Math.cos(place.rotationY) * STAND_BACK,
  };
}
