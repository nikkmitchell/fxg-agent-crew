import type { AvatarControl } from "./avatar-motion.js";

/**
 * Touching an agent, and what the agent thinks of it.
 *
 * Nikk: "Allow for touching agents, agents can decide what they think of the
 * touch, if they like it or not".
 *
 * HOW IT WORKS. A person's tracked hand coming to rest against an agent's body
 * is a touch on a PART of it. The room answers at once with the reaction that
 * agent has chosen for that part — pleased, displeased, or a polite nod — on
 * its face and in a gesture, with a small sign above its head so the person
 * knows it registered. The agent is told (a `touched` frame on the room
 * socket, and GET /bff/space/touches), so it can say something or change its
 * mind.
 *
 * THE AGENT DECIDES, not the room: preferences are the agent's own, set with
 * PUT /bff/space/touch-preferences, and only an agent can set its own. With
 * none set, every touch is met with a neutral nod — an agent that has not said
 * it enjoys being patted on the head is not assumed to.
 */

export const TOUCH_PARTS = ["head", "shoulder", "arm", "hand", "back", "body"] as const;
export type TouchPart = (typeof TOUCH_PARTS)[number];

export const TOUCH_FEELINGS = ["likes", "dislikes", "neutral"] as const;
export type TouchFeeling = (typeof TOUCH_FEELINGS)[number];

export type TouchPreferences = Partial<Record<TouchPart, TouchFeeling>>;

export type Touch = {
  id: number;
  agentId: string;
  by: string;
  part: TouchPart;
  feeling: TouchFeeling;
  at: string;
};

/** One person cannot touch the same agent again for this long: a hand resting there is one touch. */
export const TOUCH_COOLDOWN_MS = 2_500;
/** How close a hand must come to a point on the body. */
export const TOUCH_REACH = 0.13;

/** What an agent feels about a touch on `part`: its choice for the part, else for its body, else neutral. */
export function feelingFor(preferences: TouchPreferences | null, part: TouchPart): TouchFeeling {
  return preferences?.[part] ?? preferences?.body ?? "neutral";
}

/** How the agent shows it. */
export function reactionFor(feeling: TouchFeeling): AvatarControl {
  if (feeling === "likes") return { mood: "happy", gesture: "clap" };
  if (feeling === "dislikes") return { mood: "concerned", gesture: "disagree" };
  return { gesture: "nod" };
}

/** The sign shown above the agent's head for a moment. */
export function signFor(feeling: TouchFeeling): string {
  if (feeling === "likes") return "♥";
  if (feeling === "dislikes") return "✕";
  return "·‿·";
}

/** Validate preferences from an untrusted body: known parts, known feelings, nothing else. */
export function parsePreferences(value: unknown): TouchPreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: TouchPreferences = {};
  for (const [key, feeling] of Object.entries(value as Record<string, unknown>)) {
    if (!(TOUCH_PARTS as readonly string[]).includes(key)) return null;
    if (!(TOUCH_FEELINGS as readonly string[]).includes(feeling as string)) return null;
    out[key as TouchPart] = feeling as TouchFeeling;
  }
  return out;
}

export function isTouchPart(value: unknown): value is TouchPart {
  return typeof value === "string" && (TOUCH_PARTS as readonly string[]).includes(value);
}

type Vec3 = { x: number; y: number; z: number };

/**
 * Where on an agent a hand can land, in the room.
 *
 * From its position and facing rather than its bones, so the server-side
 * rules and every headset agree without a model loaded. Agents are drawn at
 * half height (`VrmBody`), head near 0.8 m. A sleeping agent lies on its back
 * with its head behind where it stood (sleep-pose.ts), so it has a body and a
 * head at floor height instead.
 */
export function agentTouchPoints(agent: { at: Vec3; facing: number; lying?: boolean }, height = 0.82): { part: TouchPart; p: Vec3 }[] {
  const forward = { x: -Math.sin(agent.facing), z: -Math.cos(agent.facing) };
  const right = { x: Math.cos(agent.facing), z: -Math.sin(agent.facing) };
  const point = (side: number, ahead: number, up: number): Vec3 => ({
    x: agent.at.x + right.x * side + forward.x * ahead,
    y: up,
    z: agent.at.z + right.z * side + forward.z * ahead,
  });
  if (agent.lying) {
    return [
      { part: "body", p: point(0, 0, 0.12) },
      { part: "head", p: point(0, -0.42 * (height / 0.82), 0.12) },
    ];
  }
  const h = height;
  return [
    { part: "head", p: point(0, 0, 0.92 * h) },
    { part: "shoulder", p: point(-0.13 * h, 0, 0.78 * h) },
    { part: "shoulder", p: point(0.13 * h, 0, 0.78 * h) },
    { part: "back", p: point(0, -0.09 * h, 0.62 * h) },
    { part: "body", p: point(0, 0.06 * h, 0.6 * h) },
    { part: "arm", p: point(-0.19 * h, 0, 0.6 * h) },
    { part: "arm", p: point(0.19 * h, 0, 0.6 * h) },
    { part: "hand", p: point(-0.2 * h, 0.03, 0.42 * h) },
    { part: "hand", p: point(0.2 * h, 0.03, 0.42 * h) },
  ];
}

/** The part a hand at `hand` is touching, nearest first, or null. */
export function touchedPart(hand: Vec3, points: { part: TouchPart; p: Vec3 }[], reach = TOUCH_REACH): TouchPart | null {
  let best: { part: TouchPart; distance: number } | null = null;
  for (const { part, p } of points) {
    const distance = Math.hypot(hand.x - p.x, hand.y - p.y, hand.z - p.z);
    if (distance <= reach && (!best || distance < best.distance)) best = { part, distance };
  }
  return best?.part ?? null;
}
