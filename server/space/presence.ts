import { ROOM, WALK_SPEED, type Vec3, deskFor } from "../../shared/space-layout.js";
import type { Pose } from "../../shared/space-wire.js";
import {
  DEFAULT_AVATAR_STATE,
  type AvatarControl,
  type AvatarState,
} from "../../shared/avatar-motion.js";
import { normaliseRotation } from "../../shared/panel-place.js";
import {
  CONVERSATION_FAR,
  ambientPauseMs,
  ambientPlace,
  conversationPlace,
} from "./social-motion.js";

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
  /**
   * When this actor last did something the audit trail recorded. Null means we
   * have never seen them do anything — which is not the same as idle, and the
   * room says so by settling them rather than by claiming they are asleep.
   */
  lastActed: number | null;
  /** True once the actor has named its own posture, which then stops being inferred. */
  declaredPosture: boolean;
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
  private readonly ambient = new Map<string, { nextAt: number; sequence: number }>();

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
    /**
     * A HUMAN ARRIVES THROUGH THE DOOR; AN AGENT IS ALREADY AT ITS DESK.
     *
     * Spawn is where you appear when you put a headset on, and that is right
     * for a person. An agent does not arrive anywhere — it is working, and its
     * desk is where it works. Starting agents at spawn piled them all on the
     * same tile by the door, which is what Nikk saw: "don't stay at the spawn
     * position find a place where nobody is".
     *
     * Desks are already one-per-actor, derived from the id, so "a place where
     * nobody is standing" comes out of that for free.
     */
    const start = connected && kind !== "agent" ? { ...ROOM.spawn } : deskFor(actorId);
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
      lastActed: null,
      declaredPosture: false,
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
    // A headset can rotate through the same direction more than once and its
    // Three.js yaw is allowed to accumulate those turns. Keep the direction,
    // but not the winding: snapshots are a public room fact and comparisons of
    // equivalent facings should not have to account for -4.71 versus 1.57.
    occupant.facing = facing >= -Math.PI && facing <= Math.PI
      ? facing
      : normaliseRotation(facing);
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
    // Somebody who moves themselves is not sent anywhere. An agent is sent
    // whether or not it is watching the room through a socket.
    if (existing && this.selfMoving(existing)) return;
    const occupant = existing ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    occupant.heading = clampToRoom(heading);
    occupant.destinationFacing = destinationFacing;
    occupant.speakingTo = null;
    occupant.because = because;
    occupant.lastActed = this.now();
    // AGENTS ONLY. A person has a posture of their own and nothing here should
    // describe it — the renderer ignores it for humans, but wrong data that
    // happens not to be read is still wrong, and somebody will read it later.
    if (occupant.kind === "agent") {
      // Acting takes an agent's posture back: whatever it declared, it is
      // demonstrably working now, and the audit trail is the better witness.
      occupant.declaredPosture = false;
      occupant.avatar.posture = "thinking";
      this.deferAmbient(actorId);
    }
    occupant.lastSeen = this.now();
  }

  /**
   * Advance everyone toward where they are going.
   *
   * Only agents are stepped: a human's client owns their position, and moving
   * them from here would fight the person holding the controller.
   */
  /**
   * Whether this occupant moves itself.
   *
   * NOT THE SAME AS `connected`, though it used to be. A person in a headset
   * has locomotion of their own and the server must not push them about; an
   * agent has no hands on a thumbstick whether or not it happens to be holding
   * a socket open. Using connectedness for both meant an agent that opened a
   * socket — to watch the room, say — silently stopped being walked to the
   * board when it acted, and stood still at the door instead.
   *
   * UNKNOWN KIND COUNTS AS SELF-MOVING. We have not been told whether that is a
   * person, and puppeting somebody who might be one is the worse mistake.
   */
  private selfMoving(occupant: Occupant): boolean {
    return occupant.connected && occupant.kind !== "agent";
  }

  /**
   * How long an agent goes on looking busy after it last did something.
   *
   * It is a posture, not a status light: an agent that has just written to the
   * board is plainly working, and one that has done nothing for five minutes is
   * plainly not. The number only decides when the figure settles, so being a
   * little wrong about it costs nothing.
   */
  private static readonly BUSY_FOR_MS = 5 * 60_000;

  /**
   * Settle every agent into the posture its own recent activity implies.
   *
   * INFERRED, NOT DECLARED, and that is the point. Nikk asked for agents that
   * are visibly doing something rather than standing like scarecrows — "if
   * you're working you can just put on a thinking animation... or I even
   * better, a meditation animation". Requiring each agent to remember to say so
   * would mean the ones that forgot stood frozen, which is the state we are
   * trying to leave. The room already knows when somebody last acted.
   *
   * AN AGENT MAY STILL OVERRIDE IT by calling `animate`, and that sticks until
   * its next action: some know they are about to be busy before the audit trail
   * does. A human's posture is never touched — they have a body of their own.
   */
  private settlePostures(): void {
    const busySince = this.now() - Presence.BUSY_FOR_MS;
    for (const occupant of this.occupants.values()) {
      if (occupant.kind !== "agent") continue;
      if (occupant.declaredPosture) continue;
      const working = occupant.lastActed !== null && occupant.lastActed > busySince;
      occupant.avatar.posture = working ? "thinking" : "sleeping";
    }
  }

  /**
   * Give a still, unoccupied agent an occasional local walk.
   *
   * This never competes with work, attention or conversation, and it never
   * carries a reason label. A label is a claim backed by an audit row; an
   * ambient circuit is simply how the requested room behaves.
   */
  private planAmbientMotion(): void {
    const now = this.now();
    for (const occupant of this.occupants.values()) {
      if (occupant.kind !== "agent") continue;
      const state = this.ambient.get(occupant.actorId) ?? {
        nextAt: now + ambientPauseMs(occupant.actorId, 0),
        sequence: 0,
      };
      this.ambient.set(occupant.actorId, state);

      const occupied = occupant.because !== null
        || occupant.attending !== null
        || occupant.speakingTo !== null;
      if (occupied) {
        state.nextAt = now + ambientPauseMs(occupant.actorId, state.sequence);
        continue;
      }
      if (isWalking(occupant) || now < state.nextAt) continue;

      occupant.heading = ambientPlace(occupant.actorId, state.sequence);
      occupant.destinationFacing = facingToward(occupant.heading, ROOM.spawn);
      state.sequence += 1;
      state.nextAt = now + ambientPauseMs(occupant.actorId, state.sequence);
    }
  }

  private deferAmbient(actorId: string): void {
    const state = this.ambient.get(actorId) ?? { nextAt: 0, sequence: 0 };
    state.nextAt = this.now() + ambientPauseMs(actorId, state.sequence);
    this.ambient.set(actorId, state);
  }

  /** Keep an agent at conversational distance as the other person moves. */
  private approachConversation(occupant: Occupant, target: Occupant): void {
    const gap = distance(occupant.at, target.at);
    if (gap > CONVERSATION_FAR) {
      occupant.heading = conversationPlace(occupant.at, target.at, occupant.actorId);
      occupant.destinationFacing = null;
    } else {
      occupant.heading = { ...occupant.at };
    }
  }

  tick(deltaSeconds: number): void {
    this.settlePostures();
    this.expireAttention();
    this.expireGestures();
    this.expireSpeakingTurns();
    this.planAmbientMotion();
    for (const occupant of this.occupants.values()) {
      if (!this.selfMoving(occupant)) {
        const conversationTarget = occupant.speakingTo
          ? this.occupants.get(occupant.speakingTo.actorId)
          : undefined;
        if (conversationTarget) this.approachConversation(occupant, conversationTarget);
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
        if (conversationTarget) {
          occupant.facing = facingToward(occupant.at, conversationTarget.at);
        }
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
    const target = this.occupants.get(targetActorId);
    occupant.speakingTo = {
      actorId: target?.actorId ?? targetActorId,
      until: this.now() + Math.max(0, durationMs),
    };
    // Turned immediately, so the speaker faces the person before the next tick
    // rather than a moment into the sentence — but only if nobody's device is
    // telling us which way they face. See the note in `tick`.
    if (target && !this.selfMoving(occupant)) {
      this.approachConversation(occupant, target);
      occupant.facing = facingToward(occupant.at, target.at);
      occupant.because = `talking with ${target.actorId}`;
      this.deferAmbient(actorId);
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
    if (control.posture) {
      occupant.avatar.posture = control.posture;
      occupant.declaredPosture = true;
    }
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
      if (occupant.speakingTo && occupant.speakingTo.until <= now) {
        const reason = `talking with ${occupant.speakingTo.actorId}`;
        if (occupant.because === reason) occupant.because = null;
        occupant.speakingTo = null;
        this.deferAmbient(occupant.actorId);
      }
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

    /**
     * A PERSON LEAVES. AN AGENT GOES BACK TO BEING AT ITS DESK.
     *
     * This used to delete anybody whose socket closed, which was right when
     * only people held sockets. It is wrong now, and the way it was wrong is
     * worth writing down: an agent that opened a socket — to watch the room,
     * to read what was said — was ERASED from the room the moment it closed
     * one. Nikk and Baiwei both looked for me in the live room and found
     * nothing, while the same code showed me perfectly in a local one where I
     * had never connected at all. Looking cost me my presence.
     *
     * An agent's presence is not a socket. It is placed by what it does, it
     * stands at its desk between times, and it is still there whether or not
     * anything of its is currently listening. Closing a connection makes it
     * DISCONNECTED — which the room already draws differently, with a broken
     * ring — not absent.
     */
    if (occupant.kind === "agent") {
      occupant.connected = false;
      return;
    }
    if (occupant.connected) {
      this.occupants.delete(actorId);
      this.ambient.delete(actorId);
    }
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
