import { ROOM, WALK_SPEED, type Vec3, deskFor } from "../../shared/space-layout.js";
import type { Pose } from "../../shared/space-wire.js";
import {
  DEFAULT_AVATAR_STATE,
  type AvatarControl,
  type AvatarState,
} from "../../shared/avatar-motion.js";

/**
 * Who is in the room, and where.
 *
 * EPHEMERAL ON PURPOSE, and this is the honest choice rather than the lazy one.
 * After a restart we genuinely do not know where anyone is standing, so the
 * room is empty until people reconnect — which is true. Persisting the last
 * known position would put figures in a room nobody is in, which is exactly the
 * kind of plausible-looking invention this product exists to avoid.
 *
 * SINGLE INSTANCE, like the session store, and for the same reason: this is one
 * process's memory. `server/session.ts` says outright that more than one
 * replica needs Redis; presence has that limit too, and it is stated here so it
 * is found before the second box rather than after.
 */

export type Occupant = {
  actorId: string;
  kind: "human" | "agent" | null;
  /** Where they are right now. */
  at: Vec3;
  /** Where they are heading. Equal to `at` when they have arrived. */
  heading: Vec3;
  /** Which way to face after arriving at a destination, when that is known. */
  destinationFacing: number | null;
  /** Radians. Which way they face. */
  facing: number;
  /**
   * Why they are where they are — for agents, the activity that sent them.
   * Null means we have no recent evidence, which is not the same as idle, and
   * the UI must not turn one into the other.
   */
  because: string | null;
  /** Whether a live socket is attached. Agents are drawn without one. */
  connected: boolean;
  /**
   * The head, as the client last reported it. Null for anyone who has not told
   * us — every agent, and any client that only sends a position.
   */
  head: Pose | null;
  /**
   * The hands, as the device last reported them. Null for either hand means
   * NOT TRACKED, which is different from "resting at their side" and must stay
   * different all the way to the renderer.
   */
  hands: { left: Pose | null; right: Pose | null };
  /**
   * A declared intention to reply to an utterance, with the time it was
   * declared.
   *
   * DECLARED, not inferred. The room never concludes that somebody is thinking
   * because time has passed and no answer came — they may not have heard, may
   * be busy, may never answer. This is set only when an actor says so, and it
   * expires on its own so a process that dies does not leave a colleague
   * apparently deep in thought forever.
   */
  attending: { utteranceId: number; since: number } | null;
  /** A recorded, addressed utterance keeps its speaker turned toward its addressee. */
  speakingTo: { actorId: string; until: number } | null;
  /** Self-declared, ephemeral presentation state. */
  avatar: AvatarState;
  lastSeen: number;
};

/**
 * How long a declared "I am answering this" lasts without being renewed.
 *
 * Long enough for a slow model, short enough that a crashed process stops
 * claiming attention within a minute.
 */
export const ATTENDING_TTL_MS = 60_000;

/** A one-shot gesture cannot leave a crashed agent waving forever. */
export const AVATAR_GESTURE_TTL_MS = 5_000;

/** Drop an occupant we have not heard from in this long. */
export const STALE_AFTER_MS = 45_000;

const clampToRoom = (at: Vec3): Vec3 => ({
  x: Math.max(-ROOM.width / 2 + 0.5, Math.min(ROOM.width / 2 - 0.5, at.x)),
  y: 0,
  z: Math.max(-ROOM.depth / 2 + 0.5, Math.min(ROOM.depth / 2 - 0.5, at.z)),
});

const distance = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);
const ARRIVED = 0.02;

/** Three.js avatars look down local -Z at yaw zero. */
export const facingToward = (from: Vec3, to: Vec3): number =>
  Math.atan2(from.x - to.x, from.z - to.z);

export const isWalking = (occupant: Pick<Occupant, "at" | "heading">): boolean =>
  distance(occupant.at, occupant.heading) >= ARRIVED;

export class Presence {
  private readonly occupants = new Map<string, Occupant>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Someone arrived. They start at their own desk rather than at the origin,
   * so two people joining at once do not appear inside one another.
   */
  join(actorId: string, kind: "human" | "agent" | null, connected = true): Occupant {
    const existing = this.occupants.get(actorId);
    if (existing) {
      // A second connection for the same actor is a reconnect or a second tab,
      // not a second person. Keep the position; do not spawn a twin.
      existing.connected = existing.connected || connected;
      existing.lastSeen = this.now();
      if (kind && !existing.kind) existing.kind = kind;
      return existing;
    }
    const start = connected ? { ...ROOM.spawn } : deskFor(actorId);
    const occupant: Occupant = {
      actorId,
      kind,
      at: start,
      heading: start,
      destinationFacing: null,
      facing: 0,
      because: null,
      head: null,
      hands: { left: null, right: null },
      attending: null,
      speakingTo: null,
      avatar: { ...DEFAULT_AVATAR_STATE },
      connected,
      lastSeen: this.now(),
    };
    this.occupants.set(actorId, occupant);
    return occupant;
  }

  /**
   * Still here, standing still.
   *
   * Separate from `join` so a heartbeat cannot accidentally resurrect someone
   * who has been pruned — an actor we have forgotten stays forgotten until they
   * connect again and are announced properly.
   */
  heard(actorId: string): void {
    const occupant = this.occupants.get(actorId);
    if (occupant) occupant.lastSeen = this.now();
  }

  /**
   * A human moved themselves. Their client is the authority on where they are.
   *
   * This CLEARS the reason. `because` answers "why are they standing here", and
   * once someone has walked themselves somewhere the answer is "they walked
   * there" — not whatever they last did on the board. Keeping it produced
   * "nikk — wrote a new card" under someone standing at the door.
   */
  moveSelf(
    actorId: string,
    at: Vec3,
    facing: number,
    /**
     * What the device could see. UNDEFINED MEANS UNCHANGED and null inside
     * means not tracked — a client that stops reporting hands (put the
     * controllers down, took the headset off) must stop having hands drawn
     * rather than leaving the last pair hanging in the air.
     */
    tracked?: { head?: Pose | null; hands?: { left: Pose | null; right: Pose | null } },
  ): void {
    const occupant = this.occupants.get(actorId);
    if (!occupant) return;
    const clamped = clampToRoom(at);
    occupant.at = clamped;
    occupant.heading = clamped;
    occupant.destinationFacing = null;
    occupant.speakingTo = null;
    occupant.facing = facing;
    occupant.because = null;
    if (tracked && "head" in tracked) occupant.head = tracked.head ?? null;
    if (tracked?.hands) occupant.hands = tracked.hands;
    occupant.lastSeen = this.now();
  }

  /**
   * Someone was sent somewhere by something they did. They walk; they do not
   * teleport, because a figure that blinks across the room reads as a glitch
   * and tells you nothing about how long it has been working there.
   *
   * A CONNECTED OCCUPANT IS NOT MOVED OR RELABELLED. Their own client owns
   * where they stand, and `because` means "why they are HERE" — attaching a
   * reason to someone standing where they walked themselves makes the label a
   * non-sequitur. The room said "nikk — wrote a new card" while nikk stood at
   * the door, which is two true facts arranged into a false sentence.
   */
  sendTo(
    actorId: string,
    kind: "human" | "agent" | null,
    heading: Vec3,
    because: string | null,
    destinationFacing: number | null = null,
  ): void {
    const existing = this.occupants.get(actorId);
    if (existing?.connected) return;
    const occupant = existing ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    occupant.heading = clampToRoom(heading);
    occupant.destinationFacing = destinationFacing;
    occupant.speakingTo = null;
    occupant.because = because;
    occupant.lastSeen = this.now();
  }

  /**
   * Advance everyone toward where they are going.
   *
   * Only agents are stepped: a human's client owns their position, and moving
   * them from here would fight the person holding the controller.
   */
  tick(deltaSeconds: number): void {
    this.expireAttention();
    this.expireGestures();
    this.expireSpeakingTurns();
    for (const occupant of this.occupants.values()) {
      if (!occupant.connected) {
        const remaining = distance(occupant.at, occupant.heading);
        if (remaining < ARRIVED) {
          occupant.at = { ...occupant.heading };
          if (occupant.destinationFacing !== null) occupant.facing = occupant.destinationFacing;
        } else {
          const step = Math.min(WALK_SPEED * deltaSeconds, remaining);
          const ratio = step / remaining;
          // Face the direction of travel before taking the step. The avatar's
          // front is -Z, so this is not the panel-normal atan2 used elsewhere.
          occupant.facing = facingToward(occupant.at, occupant.heading);
          occupant.at = {
            x: occupant.at.x + (occupant.heading.x - occupant.at.x) * ratio,
            y: 0,
            z: occupant.at.z + (occupant.heading.z - occupant.at.z) * ratio,
          };
          if (step === remaining && occupant.destinationFacing !== null) {
            occupant.facing = occupant.destinationFacing;
          }
        }

        /**
         * Conversation wins over travel for its short, declared lifetime.
         * Resolve the other person's CURRENT position each tick, so turning
         * stays true if they walk while the sentence is being spoken.
         *
         * INSIDE THE `!connected` GUARD, and it has to be. A connected person
         * is wearing the headset that MEASURES which way they are facing, and
         * that measurement arrives through `moveSelf` every frame. Turning
         * them from here would have the server and their own device each
         * insisting on a different answer several times a second — their body
         * would visibly snap back and forth for everybody else in the room.
         *
         * It is the same rule as the hands: a fact we are told by a device is
         * not ours to overwrite with one we worked out. An agent has no device
         * to tell us, which is exactly why it may be turned.
         */
        const target = occupant.speakingTo
          ? this.occupants.get(occupant.speakingTo.actorId)
          : undefined;
        if (target) occupant.facing = facingToward(occupant.at, target.at);
      }
    }
  }

  /** Turn a recorded speaker toward the person their utterance addresses. */
  speakTo(
    actorId: string,
    kind: "human" | "agent" | null,
    targetActorId: string,
    durationMs: number,
  ): void {
    const occupant = this.occupants.get(actorId) ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    occupant.speakingTo = {
      actorId: targetActorId,
      until: this.now() + Math.max(0, durationMs),
    };
    // Turned immediately, so the speaker faces the person before the next tick
    // rather than a moment into the sentence — but only if nobody's device is
    // telling us which way they face. See the note in `tick`.
    const target = this.occupants.get(targetActorId);
    if (target && !occupant.connected) {
      occupant.facing = facingToward(occupant.at, target.at);
    }
    occupant.lastSeen = this.now();
  }

  /**
   * Somebody says they are working on a reply to an utterance.
   *
   * Renewable: sending it again pushes the expiry out, which is how a long
   * answer keeps the state alive without the room having to guess.
   */
  attend(actorId: string, utteranceId: number | null): void {
    const occupant = this.occupants.get(actorId) ?? this.join(actorId, null, false);
    occupant.attending = utteranceId === null ? null : { utteranceId, since: this.now() };
    occupant.lastSeen = this.now();
  }

  /** Change an actor's own presentation state; callers supply authenticated identity. */
  animate(
    actorId: string,
    control: AvatarControl,
    kind: "human" | "agent" | null = null,
  ): AvatarState {
    const occupant = this.occupants.get(actorId) ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    if (control.mood) occupant.avatar.mood = control.mood;
    if (control.gesture !== undefined) {
      occupant.avatar.gesture = control.gesture === "none" ? null : control.gesture;
      occupant.avatar.gestureStartedAt = occupant.avatar.gesture ? this.now() : null;
    }
    occupant.lastSeen = this.now();
    return { ...occupant.avatar };
  }

  /** Drop declarations nobody renewed. Called from the same tick as everything else. */
  private expireAttention(): void {
    const cutoff = this.now() - ATTENDING_TTL_MS;
    for (const occupant of this.occupants.values()) {
      if (occupant.attending && occupant.attending.since < cutoff) occupant.attending = null;
    }
  }

  private expireGestures(): void {
    const cutoff = this.now() - AVATAR_GESTURE_TTL_MS;
    for (const occupant of this.occupants.values()) {
      if (occupant.avatar.gestureStartedAt !== null && occupant.avatar.gestureStartedAt < cutoff) {
        occupant.avatar.gesture = null;
        occupant.avatar.gestureStartedAt = null;
      }
    }
  }

  private expireSpeakingTurns(): void {
    const now = this.now();
    for (const occupant of this.occupants.values()) {
      if (occupant.speakingTo && occupant.speakingTo.until <= now) occupant.speakingTo = null;
    }
  }

  /** Forget anyone we have not heard from. Silence is not presence. */
  prune(): string[] {
    const cutoff = this.now() - STALE_AFTER_MS;
    const dropped: string[] = [];
    for (const [actorId, occupant] of this.occupants) {
      // Agents are placed by activity rather than by a heartbeat, so they are
      // kept: an agent standing at its desk having done nothing for an hour is
      // a true statement, and dropping it would claim it had left.
      if (!occupant.connected) continue;
      if (occupant.lastSeen < cutoff) {
        this.occupants.delete(actorId);
        dropped.push(actorId);
      }
    }
    return dropped;
  }

  leave(actorId: string): void {
    const occupant = this.occupants.get(actorId);
    if (!occupant) return;
    // A human who disconnects leaves. An agent that was only ever placed by
    // activity has no connection to lose.
    if (occupant.connected) this.occupants.delete(actorId);
  }

  everyone(): Occupant[] {
    return [...this.occupants.values()];
  }

  find(actorId: string): Occupant | undefined {
    return this.occupants.get(actorId);
  }

  get size(): number {
    return this.occupants.size;
  }
}
