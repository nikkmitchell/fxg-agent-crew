import type { GoRoomItem } from "./room-items.js";
import type { Pose } from "./space-wire.js";
import { GO_SURFACE, goTouchBowl, goTouchIntersection, type Point3 } from "./go-layout.js";
import { placeGoStone } from "./go-rules.js";

export type GoTouchState = { inside: boolean; armed: boolean; target: string | null; since: number };
export const idleGoTouch = (): GoTouchState => ({ inside: false, armed: false, target: null, since: 0 });
export type GoContactAction = { action: "lift" } | { action: "place"; x: number; y: number };
/** Fresh contact only; leave the bowl before placing, then dwell 180ms to reject sweeps.
 * Once emitted, a contact cannot send again until it leaves that intersection. */
export function stepGoTouch(state: GoTouchState, input: {
  point: Point3 | null; item: GoRoomItem; holding: boolean; canLift: boolean; now: number; pending?: boolean;
}): { state: GoTouchState; action: GoContactAction | null } {
  const { point, item, holding, canLift, now } = input;
  // A socket acknowledgement can precede the HTTP reply. Wait for dispatch to
  // reopen and require a fresh dwell; never consume an action we cannot send.
  if (input.pending) return { state: { ...state, target: null, since: now }, action: null };
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

/**
 * Where a lifted stone is drawn, in the room, or null when there is no fresh
 * hand to put it at (the stone then stays where it was: lost tracking never
 * places a remembered hand).
 *
 * YOURS IS AT YOUR FINGERTIP — the same point that plays it. Nikk: "the touch
 * position is not where the stone floats to ... the stone should float out to
 * the position of where the collider is, so you move the stone that's floating
 * down and you can place it". It used to float at the palm (goCarryPoint)
 * while the fingertip played the board.
 *
 * Somebody else's follows their palm: only a wrist crosses the socket.
 */
export function heldStoneWorld(input: {
  yours: boolean;
  /** Your own measured hand, if it is fresh. */
  fingertip: Point3 | null;
  /** The carrier's wrist as the room last heard it, for somebody else's stone. */
  theirWrist: Pose | null;
}): Point3 | null {
  if (input.yours) return input.fingertip;
  return input.theirWrist ? goCarryPoint(input.theirWrist) : null;
}

/** In table coordinates: resting ON the board as the finger reaches it, never sunk into it. */
export function restOnBoard(local: Point3, stoneHalfHeight: number): Point3 {
  return { ...local, y: Math.max(local.y, GO_SURFACE + stoneHalfHeight) };
}
