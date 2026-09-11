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
import type { Utterance } from "./voice.js";

/** Orientation as a quaternion, in wire order. */
export type Quat = { x: number; y: number; z: number; w: number };

/**
 * Where a tracked thing is and which way it is turned.
 *
 * Quaternions rather than Euler angles because a head is not a compass: it
 * pitches and rolls as well as turning, and yaw alone cannot say "looking down
 * at the desk" or "head tilted". The flat view can only report yaw, and says so
 * by sending a yaw-only quaternion — it does not invent a pitch.
 */
export type Pose = { p: Vec3; q: Quat };

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
  /**
   * The head, when the client reports one.
   *
   * NULL MEANS WE WERE NOT TOLD, and the renderer must place the head from
   * `at` and `facing` instead — which is what happens for an agent, whose
   * position comes from the audit trail and who has no head to track.
   */
  head: Pose | null;
  /**
   * The hands, when the device tracks them.
   *
   * Null for either hand means NOT TRACKED — not "by their side". Somebody at a
   * desk with a mouse has no hands in this room, and drawing them a pair would
   * be inventing the one thing hands are good at showing: what a person is
   * actually doing with them.
   */
  hands: { left: Pose | null; right: Pose | null };
  /**
   * An utterance this actor has SAID it is answering, or null.
   *
   * Null means we have not been told they are working on anything — which is
   * not the same as knowing they are idle. Never inferred from silence: the
   * room cannot see inside a process, and "they have not replied yet" is a fact
   * about the listener, not about the speaker.
   */
  attending: { utteranceId: number } | null;
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
   * Somebody said something.
   *
   * Sent on the SAME socket as positions, but as its own message rather than
   * folded into a snapshot: a snapshot is the current state and is safe to
   * miss, while an utterance is an event and missing one loses it. A client
   * that reconnects refetches the recent ones over HTTP.
   */
  | { type: "said"; utterance: Utterance }
  /**
   * Sent instead of closing silently. A socket that vanishes without a reason
   * is indistinguishable from a network failure, and the UI would have to guess.
   */
  | { type: "refused"; reason: string };

/** Client → server. */
export type ClientMessage =
  /**
   * I moved myself. My client owns my position; the server owns everyone
   * else's.
   *
   * `head` and `hands` are OPTIONAL and absent means "I cannot tell you",
   * which is the truth for a browser window with a mouse. An older client that
   * only knows how to send a position keeps working and is simply drawn
   * without them.
   */
  | {
      type: "move";
      at: Vec3;
      facing: number;
      head?: Pose;
      hands?: { left: Pose | null; right: Pose | null };
    }
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
    const at = vec3(message.at);
    if (!at || !isFinite(message.facing)) return null;
    const head = pose(message.head);
    const hands = message.hands as Record<string, unknown> | undefined;
    return {
      type: "move",
      at,
      facing: message.facing as number,
      // A malformed head is dropped rather than rejecting the whole frame: the
      // position in it is still good, and a client with a broken tracker should
      // still be able to walk around.
      ...(head ? { head } : {}),
      ...(typeof hands === "object" && hands !== null
        ? { hands: { left: pose(hands.left), right: pose(hands.right) } }
        : {}),
    };
  }
  return null;
}

function vec3(value: unknown): Vec3 | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!isFinite(candidate.x) || !isFinite(candidate.y) || !isFinite(candidate.z)) return null;
  return { x: candidate.x as number, y: candidate.y as number, z: candidate.z as number };
}

/**
 * A pose, or null for anything we cannot read.
 *
 * The quaternion is checked for length as well as for finiteness. A degenerate
 * one — all zeros is the common case when a tracker has not locked on — is not
 * a rotation at all, and three.js turns it into NaN the moment it is used,
 * which then spreads into every matrix it touches.
 */
function pose(value: unknown): Pose | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const p = vec3(candidate.p);
  const q = candidate.q as Record<string, unknown> | undefined;
  if (!p || typeof q !== "object" || q === null) return null;
  if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) return null;
  const length = Math.hypot(q.x as number, q.y as number, q.z as number, q.w as number);
  if (length < 0.5 || length > 1.5) return null;
  return {
    p,
    q: { x: q.x as number, y: q.y as number, z: q.z as number, w: q.w as number },
  };
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
