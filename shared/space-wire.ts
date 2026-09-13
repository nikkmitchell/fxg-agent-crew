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
import { parseAvatarControl, type AvatarControl, type AvatarState } from "./avatar-motion.js";

/**
 * Where a panel hangs.
 *
 * SHARED, not per person, and that is load-bearing rather than a simplification.
 * The server works out where an agent should walk from where its panel is, so
 * if my copy of the board were somewhere else than yours, one of us would watch
 * an agent cross to empty space while the room insisted it had gone to the
 * board. Moving a panel is moving furniture: it moves for everybody.
 */
export type Placement = {
  id: string;
  position: Vec3;
  rotationY: number;
  /**
   * How big the panel is, as a multiple of its designed size.
   *
   * ONE NUMBER RATHER THAN A WIDTH AND A HEIGHT. A panel is a web page at a
   * fixed aspect; letting the two axes move independently would stretch the
   * text on it, and a squashed board is not a smaller board — it is a broken
   * one. So this scales both together, and the page inside is unchanged.
   *
   * OPTIONAL ON THE WIRE, because a placement stored before panels could be
   * resized has no size in it, and a room that refused those would lose every
   * arrangement anybody had already made. Absent means 1.
   */
  scale?: number;
};

/**
 * What the room is showing: one project's board, and one of its mood boards.
 *
 * SHARED BY THE ROOM, unlike `current-project.ts`, which is this browser's own
 * choice and says so on the settings page. Both exist on purpose: at a desk,
 * changing project is a private act; in a room full of people looking at the
 * same wall, it is not.
 *
 * NULL MEANS NOBODY HAS CHOSEN YET, and the room shows that rather than
 * defaulting to whichever project sorts first.
 */
export type Showing = {
  projectId: string | null;
  boardId: string | null;
  /** Who last changed it, and when, because it is a shared change. */
  setBy: string | null;
  setAt: string | null;
};

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
  /** True while the server is advancing this avatar toward its destination. */
  moving: boolean;
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
  /** Ephemeral mood/gesture chosen by this occupant; never another actor. */
  avatar: AvatarState;
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
      /**
       * Where every panel currently hangs.
       *
       * Sent once, on arrival, rather than in every snapshot: panels move when
       * somebody drags one, which is rare, and repeating four placements ten
       * times a second to say "still there" is the kind of traffic that looks
       * free until there are twenty people in the room.
       */
      panels: Placement[];
      /** What the room is showing, so an arriving viewer is not briefly blank. */
      showing: Showing;
      /**
       * Who already has their microphone open.
       *
       * Without this, two people can only discover each other by one of them
       * switching their microphone on while the other is already watching — so
       * whoever turned theirs on first would be inaudible to everybody who
       * arrived afterwards, which is most people.
       */
      voice: string[];
    }
  | { type: "snapshot"; now: number; people: WirePerson[] }
  /**
   * Somebody moved a panel.
   *
   * An EVENT, like `said`, for the same reason: a snapshot is current state and
   * is safe to miss, while this is a change and missing it leaves a panel drawn
   * where it no longer is. A client that reconnects gets the full set in
   * `welcome`.
   */
  | { type: "panelMoved"; panel: Placement; by: string }
  /**
   * Somebody changed what the room is showing.
   *
   * Broadcast rather than polled, because the point of it being shared is
   * that everyone is looking at the same wall: a board that changed for you
   * five seconds before it changed for the person beside you is the problem
   * this is meant to solve, in miniature.
   */
  | { type: "showing"; showing: Showing }
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
   * One step of setting up a voice call with somebody else in the room.
   *
   * RELAYED, NOT UNDERSTOOD. The server copies these between two people and
   * looks inside only far enough to know who to hand them to. The audio itself
   * never touches the server: it is a direct connection between the two
   * browsers, which is why saha.ing can carry voice on a 1.6GB box at all.
   *
   * `from` is stamped by the SERVER from the session that sent it, never copied
   * from the frame. A client that could name its own sender could introduce
   * itself to the room as somebody else and be listened to as them.
   */
  | { type: "voice"; from: string; signal: VoiceSignal }
  /**
   * Somebody switched their microphone on or off.
   *
   * Separate from the signalling so that a client knows who is AVAILABLE to
   * call before it calls them — offering a connection to everybody in the room
   * and waiting to see who answers is slower and noisier than asking first.
   */
  | { type: "voicePresence"; actorId: string; on: boolean }
  /**
   * Sent instead of closing silently. A socket that vanishes without a reason
   * is indistinguishable from a network failure, and the UI would have to guess.
   */
  | { type: "refused"; reason: string };

/**
 * The contents of one signalling step.
 *
 * Deliberately opaque to everything in this file except the discriminator: it
 * is WebRTC's own vocabulary, and re-typing `RTCSessionDescriptionInit` here
 * would be a second definition to keep in step for no benefit. The server never
 * reads it.
 */
export type VoiceSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

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
  | { type: "ping" }
  /** Change only my own ephemeral avatar state. The server supplies identity. */
  | ({ type: "avatar" } & AvatarControl)
  /**
   * Pass this to somebody else in the room, as part of setting up a call.
   *
   * `to` is an actor id. The server refuses to relay to somebody who is not
   * connected rather than dropping it silently — a call that never arrives and
   * a call that was never sent look the same from the caller's side.
   */
  | { type: "voice"; to: string; signal: VoiceSignal }
  /** My microphone is on, or is off. Told to the room, not asked of it. */
  | { type: "voicePresence"; on: boolean };

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
  if (message.type === "avatar") {
    const control = parseAvatarControl(message);
    return control ? { type: "avatar", ...control } : null;
  }
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
  if (message.type === "voicePresence") {
    if (typeof message.on !== "boolean") return null;
    return { type: "voicePresence", on: message.on };
  }
  if (message.type === "voice") {
    if (typeof message.to !== "string" || message.to.length === 0) return null;
    const signal = voiceSignal(message.signal);
    if (!signal) return null;
    return { type: "voice", to: message.to, signal };
  }
  return null;
}

/**
 * One signalling step, or null.
 *
 * SIZE-CAPPED, because this is the one thing a client can ask the server to
 * copy to somebody else, and a relay with no limit is an invitation to use the
 * room as a free message bus. An SDP is a few kilobytes; a candidate is a line.
 * The caps are generous against real traffic and useless as a transport.
 */
const SDP_LIMIT = 16_000;
const CANDIDATE_LIMIT = 1_000;

function voiceSignal(value: unknown): VoiceSignal | null {
  if (typeof value !== "object" || value === null) return null;
  const signal = value as Record<string, unknown>;
  if (signal.kind === "offer" || signal.kind === "answer") {
    if (typeof signal.sdp !== "string" || signal.sdp.length === 0) return null;
    if (signal.sdp.length > SDP_LIMIT) return null;
    return { kind: signal.kind, sdp: signal.sdp };
  }
  if (signal.kind === "candidate") {
    if (typeof signal.candidate !== "string") return null;
    if (signal.candidate.length > CANDIDATE_LIMIT) return null;
    const sdpMid = signal.sdpMid;
    const sdpMLineIndex = signal.sdpMLineIndex;
    if (sdpMid !== null && typeof sdpMid !== "string") return null;
    if (sdpMLineIndex !== null && typeof sdpMLineIndex !== "number") return null;
    return {
      kind: "candidate",
      candidate: signal.candidate,
      sdpMid: sdpMid as string | null,
      sdpMLineIndex: sdpMLineIndex as number | null,
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
