import { ROOM, deskFor, type Vec3 } from "../../shared/space-layout.js";

/** Comfortable face-to-face spacing: close enough to talk, not body overlap. */
export const CONVERSATION_DISTANCE = 1.35;
export const CONVERSATION_FAR = 1.8;

/** Idle agents pause between small, local walks instead of pacing continuously. */
export const AMBIENT_PAUSE_MIN_MS = 18_000;
const AMBIENT_PAUSE_SPREAD_MS = 22_000;

const hash = (value: string): number => [...value].reduce(
  (accumulated, character) =>
    Math.imul(accumulated ^ character.charCodeAt(0), 16_777_619) >>> 0,
  2_166_136_261,
);

const unit = (value: string): number => hash(value) / 0xffff_ffff;
const inside = (at: Vec3, margin = 0.65): boolean =>
  Math.abs(at.x) <= ROOM.width / 2 - margin && Math.abs(at.z) <= ROOM.depth / 2 - margin;

/**
 * A place from which an agent can speak to somebody without standing inside
 * them. The preferred side is the one nearest the speaker; near a wall we try
 * neighbouring points around the listener until the full gap fits in-room.
 */
export function conversationPlace(speaker: Vec3, listener: Vec3, actorId: string): Vec3 {
  const dx = speaker.x - listener.x;
  const dz = speaker.z - listener.z;
  const desired = Math.hypot(dx, dz) > 0.001
    ? Math.atan2(dz, dx)
    : unit(`${actorId}:conversation`) * Math.PI * 2;
  const turns = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];

  for (const turn of turns) {
    const angle = desired + turn * Math.PI / 6;
    const candidate = {
      x: listener.x + Math.cos(angle) * CONVERSATION_DISTANCE,
      y: 0,
      z: listener.z + Math.sin(angle) * CONVERSATION_DISTANCE,
    };
    if (inside(candidate)) return candidate;
  }

  // A listener cannot normally be outside the room, but keep the planner
  // bounded if a stale or pre-clamp sample reaches it.
  return {
    x: Math.max(-ROOM.width / 2 + 0.65, Math.min(ROOM.width / 2 - 0.65, listener.x)),
    y: 0,
    z: Math.max(-ROOM.depth / 2 + 0.65, Math.min(ROOM.depth / 2 - 0.65, listener.z)),
  };
}

/** Stable per-agent pauses keep a group from setting off in lockstep. */
export function ambientPauseMs(actorId: string, sequence: number): number {
  return AMBIENT_PAUSE_MIN_MS
    + Math.round(unit(`${actorId}:pause:${sequence}`) * AMBIENT_PAUSE_SPREAD_MS);
}

/**
 * A small circuit around the actor's desk.
 *
 * This movement carries no reason label: it is atmosphere requested for the
 * room, not evidence that the actor did work. The back desk row is pulled
 * inward before the radius is applied so nobody walks along the wall.
 */
export function ambientPlace(actorId: string, sequence: number): Vec3 {
  const desk = deskFor(actorId);
  const centre = {
    x: desk.x,
    z: Math.min(desk.z, ROOM.depth / 2 - 2.1),
  };
  const angle = unit(`${actorId}:angle:${sequence}`) * Math.PI * 2;
  const radius = 0.7 + unit(`${actorId}:radius:${sequence}`) * 0.9;
  const candidate = {
    x: centre.x + Math.cos(angle) * radius,
    y: 0,
    z: centre.z + Math.sin(angle) * radius,
  };
  return {
    x: Math.max(-ROOM.width / 2 + 0.65, Math.min(ROOM.width / 2 - 0.65, candidate.x)),
    y: 0,
    z: Math.max(-ROOM.depth / 2 + 0.65, Math.min(ROOM.depth / 2 - 0.65, candidate.z)),
  };
}
