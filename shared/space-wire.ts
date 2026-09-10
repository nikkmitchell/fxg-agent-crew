/**
 * What travels over the space socket.
 *
 * One definition, two consumers — the same reasoning as the layout. A wire
 * format written twice is a wire format that drifts, and the failure mode is a
 * silent one: the client reads a field the server stopped sending and renders
 * `undefined` as a position at the origin.
 *
 * Deliberately small. Positions are sent as three numbers rather than as a
 * class, because this is a snapshot of where things are, not an object graph.
 */

import type { Vec3 } from "./space-layout.js";

/** One occupant, as the browser needs to draw them. */
export type WirePerson = {
  actorId: string;
  /**
   * null means we have not been told, and the renderer must SHOW that rather
   * than pick one. Three of the five actors in the live database are in this
   * state; drawing them as human would be an invention.
   */
  kind: "human" | "agent" | null;
  at: Vec3;
  facing: number;
  /** Why they are there, when we know. null is "no recent evidence". */
  because: string | null;
  /** Whether a live socket is attached — a person in the room right now. */
  connected: boolean;
};

/** Server → client. */
export type ServerMessage =
  | {
      type: "welcome";
      /** Who the server decided you are, from the cookie. Never from the client. */
      you: string;
      /** Server time when this was sent, so a client can size its clock skew. */
      now: number;
      people: WirePerson[];
    }
  | { type: "snapshot"; now: number; people: WirePerson[] }
  /**
   * Sent instead of closing silently. A socket that vanishes without a reason
   * is indistinguishable from a network failure, and the UI would have to guess.
   */
  | { type: "refused"; reason: string };

/** Client → server. */
export type ClientMessage =
  /** I moved myself. My client owns my position; the server owns everyone else's. */
  | { type: "move"; at: Vec3; facing: number }
  /** Still here. Cheaper than a move when standing still. */
  | { type: "ping" };

/**
 * Parse a client frame without trusting any of it.
 *
 * Returns null for anything malformed rather than throwing — a bad frame is a
 * thing to ignore and count, not a reason to tear down a socket that may be
 * fine.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "ping") return { type: "ping" };
  if (message.type === "move") {
    const at = message.at as Record<string, unknown> | undefined;
    const facing = message.facing;
    if (typeof at !== "object" || at === null) return null;
    if (!isFinite(at.x) || !isFinite(at.y) || !isFinite(at.z) || !isFinite(facing)) return null;
    return {
      type: "move",
      at: { x: at.x as number, y: at.y as number, z: at.z as number },
      facing: facing as number,
    };
  }
  return null;
}

/**
 * NaN and Infinity are the interesting cases, not strings.
 *
 * `JSON.parse` cannot produce them, but a client can send `1e999`, which parses
 * to Infinity — and an Infinity position propagates into every distance
 * calculation on the server and poisons the snapshot for everyone else.
 */
function isFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}
