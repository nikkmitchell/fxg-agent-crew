import type { GoRoomItem } from "./room-items.js";
import type { Pose } from "./space-wire.js";
import { goTouchBowl, goTouchIntersection, type Point3 } from "./go-layout.js";
import { placeGoStone } from "./go-rules.js";

export type GoTouchState = { inside: boolean; armed: boolean; target: string | null; since: number };
export const idleGoTouch = (): GoTouchState => ({ inside: false, armed: false, target: null, since: 0 });
export type GoContactAction = { action: "lift" } | { action: "place"; x: number; y: number };
/** Fresh contact only; leave the bowl before placing, then dwell 180ms to reject sweeps.
 * Once emitted, a contact cannot send again until it leaves that intersection. */
export function stepGoTouch(state: GoTouchState, input: {
  point: Point3 | null; item: GoRoomItem; holding: boolean; canLift: boolean; now: number;
}): { state: GoTouchState; action: GoContactAction | null } {
  const { point, item, holding, canLift, now } = input;
  if (!point) return { state: { ...state, inside: false, target: null }, action: null };
  const inside = goTouchBowl(point, item);
  if (!holding) return { state: { inside, armed: false, target: null, since: now }, action: canLift && inside && !state.inside ? { action: "lift" } : null };
  const next = { ...state, inside, armed: state.armed || !inside };
  const pointOnBoard = next.armed ? goTouchIntersection(point, item.size) : null;
  if (!pointOnBoard || "error" in placeGoStone(item.stones, item.size, { ...pointOnBoard, colour: item.activeColour })) return { state: { ...next, target: null }, action: null };
  const key = `${pointOnBoard.x},${pointOnBoard.y}`;
  if (next.target !== key) return { state: { ...next, target: key, since: now }, action: null };
  if (now - next.since < 180) return { state: next, action: null };
  return { state: { ...next, since: Infinity }, action: { action: "place", ...pointOnBoard } };
}

/** Same palm offset locally and remotely; controller grips use wrist convention too. */
export function goCarryPoint(pose: Pose): Point3 {
  const { x, y, z, w } = pose.q;
  return { x: pose.p.x - 0.08 * (2 * (x * z + w * y)),
    y: pose.p.y - 0.08 * (2 * (y * z - w * x)) + 0.075,
    z: pose.p.z - 0.08 * (1 - 2 * (x * x + y * y)) };
}
