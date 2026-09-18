import { ROOM, WALK_SPEED, actorKey, clampToWorld, type Vec3, deskFor } from "../../shared/space-layout.js";
import type { PostureMemory } from "./postures.js";
import { facingToward, type AgentHome } from "../../shared/agent-home.js";
import type { Pose } from "../../shared/space-wire.js";
import {
  DEFAULT_AVATAR_STATE,
  MAX_GESTURE_HOLD_MS,
  type AvatarControl,
  type AvatarState,
} from "../../shared/avatar-motion.js";
import { normaliseRotation } from "../../shared/panel-place.js";
import { standingRoomNear } from "../../shared/standing-room.js";
import { CONVERSATION_FAR, conversationPlace } from "./social-motion.js";
import {
  apparentVelocity,
  besideSpot,
  defaultSide,
  type Sample,
} from "../../shared/walk-beside.js";

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
  /**
   * Somebody this actor is walking with, until told otherwise.
   *
   * A STANDING INTENTION rather than a destination, which is the whole point:
   * "walk beside Nikk2" survives Nikk2 moving, and a heading does not. It ends
   * when the follower says so or the target leaves — never silently, because a
   * follower that has quietly stopped following looks exactly like one whose
   * target is standing still.
   */
  following: { actorId: string; side: "left" | "right"; because: string | null } | null;
  /**
   * A route still to walk: the waypoints not yet reached, in order.
   *
   * ONE INSTRUCTION INSTEAD OF A TIMER, the same argument as `following`.
   * Waffle built a tour out of a home re-sent every two seconds, which is a
   * clock in the agent that drifts, stops when the agent is busy, and cannot be
   * seen by anybody. An empty array is arrival, and the field goes back to null.
   */
  walking: { waypoints: Vec3[]; because: string | null } | null;
  /** Self-declared, ephemeral presentation state. */
  avatar: AvatarState;
  /**
   * When this actor last did something the audit trail recorded. Null means we
   * have never seen them do anything — which is not the same as idle, and the
   * room says so by settling them rather than by claiming they are asleep.
   */
  lastActed: number | null;
  /** Their own measured standing height in metres, or null if never reported. */
  standing: number | null;
  /** True once the actor has named its own posture, which then stops being inferred. */
  declaredPosture: boolean;
  /** When that posture was named, for letting an unattended "thinking" lapse. */
  declaredAt: number | null;
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

/**
 * Make a position safe to hold and hand out. NOT A BOUNDARY ANY MORE.
 *
 * Nikk: "remove the limited walking boundary we don't want to have any limit
 * to walking". This used to pull anybody who reached the edge of ROOM back
 * inside — and it ran on SELF-REPORTED positions too, so removing the rail in
 * the browser alone would have been a half-fix of the worst kind: the walker
 * would see themselves stroll out into the dark while everybody else watched
 * them stand still at the wall, because the server kept overwriting where they
 * said they were. The wall would have looked removed to precisely one person.
 *
 * What is left only keeps the number finite and sane — see WORLD.
 */
const clampToRoom = (at: Vec3): Vec3 => clampToWorld(at);

const distance = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);
const ARRIVED = 0.02;

/**
 * Three.js avatars look down local -Z at yaw zero.
 *
 * Re-exported, not defined here: it moved to shared/agent-home.ts so the room's
 * renderer, the home route and this settle loop cannot drift apart on the sign.
 * Every existing caller keeps importing it from presence, where they found it.
 */
export { facingToward };

export const isWalking = (occupant: Pick<Occupant, "at" | "heading">): boolean =>
  distance(occupant.at, occupant.heading) >= ARRIVED;

export class Presence {
  private readonly occupants = new Map<string, Occupant>();
  /** When each agent's shared screen last had a live picture, by actor key. */
  private readonly screenSeenAt = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    /**
     * Where declared postures are kept across a restart. Optional so every
     * existing test, and anything that wants a purely in-memory room, is
     * unchanged. See postures.ts.
     */
    private readonly postures: PostureMemory | null = null,
    /** Agents' saved homes; without one, an agent's home is its desk. See homes.ts. */
    private readonly homes: { get(actorId: string): AgentHome | null } | null = null,
    /** Whether this actor's shared screen is sending pictures right now. See settlePostures. */
    private readonly screenLive: ((actorId: string) => boolean) | null = null,
  ) {}

  /**
   * Someone arrived. They start at their own desk rather than at the origin,
   * so two people joining at once do not appear inside one another.
   */
  join(actorId: string, kind: "human" | "agent" | null, connected = true): Occupant {
    const key = actorKey(actorId);
    const existing = this.occupants.get(key);
    if (existing) {
      // A second connection for the same actor is a reconnect or a second tab,
      // not a second person. Keep the position; do not spawn a twin.
      const wasConnected = existing.connected;
      existing.connected = existing.connected || connected;
      // A live authenticated session is stronger evidence for how this actor
      // spells their name in the room than an audit row that arrived first.
      // A later case-variant tab does not get to rename an already-connected
      // person; first live spelling wins for that presence.
      if (connected && !wasConnected) existing.actorId = actorId;
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
    // An agent with a saved home arrives there, facing the way it was placed.
    const home = connected && kind !== "agent" ? null : (this.homes?.get(actorId) ?? null);
    const wanted = connected && kind !== "agent" ? { ...ROOM.spawn } : (home?.at ?? deskFor(actorId));
    /**
     * NOT ON TOP OF WHOEVER IS ALREADY THERE, at the moment of arriving.
     *
     * Resting places are derived from a name out of twelve slots, so two actors
     * share one readily — `deskFor("Inkstone")` and `deskFor("nikk2")` are the
     * same point. An agent joining went straight to its slot whatever was
     * standing on it, which put it inside a person before it had done anything
     * at all. Found by a test aimed at the ambient wander, which never got as
     * far as wandering because the spawn had already failed.
     *
     * A PERSON IS PLACED WHERE THEIR HEADSET SAYS, so this only rearranges an
     * arrival we are entitled to move. A connected human goes to spawn and
     * their own client corrects it on the next frame; nudging them would be
     * overwriting a device's word with our own.
     */
    const start = connected && kind !== "agent"
      ? wanted
      : standingRoomNear(wanted, [...this.occupants.values()].map((o) => o.heading), actorId, clampToRoom);
    const occupant: Occupant = {
      actorId,
      kind,
      at: start,
      heading: start,
      destinationFacing: null,
      facing: home?.facing ?? 0,
      because: null,
      head: null,
      hands: { left: null, right: null },
      attending: null,
      speakingTo: null,
      following: null,
      walking: null,
      avatar: { ...DEFAULT_AVATAR_STATE },
      lastActed: null,
      standing: null,
      declaredPosture: false,
      declaredAt: null,
      connected,
      lastSeen: this.now(),
    };
    // What this actor last said it was doing, if it said so before a restart
    // and has not acted since.
    const declared = this.postures?.recall(actorId) ?? null;
    if (declared) {
      occupant.avatar.posture = declared;
      occupant.declaredPosture = true;
      // The clock starts again after a restart: the room cannot know when it was said.
      occupant.declaredAt = this.now();
    }
    this.occupants.set(key, occupant);
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
    const occupant = this.occupants.get(actorKey(actorId));
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
    /**
     * How tall they say they are. UNDEFINED MEANS UNCHANGED, like the tracked
     * poses above: a client that does not measure heights must not erase the
     * one this person's headset reported.
     */
    standing?: number,
  ): void {
    const occupant = this.occupants.get(actorKey(actorId));
    if (!occupant) return;
    if (standing !== undefined) occupant.standing = standing;
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
    const existing = this.occupants.get(actorKey(actorId));
    // Somebody who moves themselves is not sent anywhere. An agent is sent
    // whether or not it is watching the room through a socket.
    if (existing && this.selfMoving(existing)) return;
    const occupant = existing ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    /**
     * NOT ON TOP OF SOMEBODY ELSE.
     *
     * `destinationFor` returns ONE point per panel and returns the same one to
     * everybody, so two agents that both commented on a card were both sent to
     * identical coordinates and stood inside each other. Nikk, from a headset:
     * "now both agents are standing in the same place looking at the board".
     *
     * AGAINST EVERYBODY'S HEADING, NOT THEIR CURRENT POSITION, and that is the
     * whole reason this works. Two agents sent to the same board are both a
     * long way off at the moment they are sent, so comparing where they are
     * standing would find the target empty for both and they would converge on
     * it anyway. `heading` is where each one has already claimed it will end
     * up — and `moveSelf` keeps a person's heading equal to their position, so
     * a human counts as claiming the ground they are on.
     *
     * The mover is excluded: a figure is always nought metres from itself.
     */
    occupant.heading = this.roomFor(occupant, clampToRoom(heading));
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
      this.actedOverDeclaration(occupant);
      occupant.avatar.posture = "thinking";
    }
    occupant.lastSeen = this.now();
  }

  /**
   * Put an agent back where the room had already worked out it belongs, after
   * a restart emptied the building.
   *
   * NOT `sendTo`, for two reasons that both matter.
   *
   * `sendTo` sets a HEADING and lets `tick` walk the figure there. That is
   * right for an action — an agent crossing the room IS an audit row, and the
   * journey is the point. It is wrong here: the agent did not just set off, it
   * was already standing there before the deploy, and showing it striding in
   * from its desk would animate a journey that never happened.
   *
   * `sendTo` also stamps `lastActed` with the current time, which after a
   * restart would tell the room that every agent in the building had acted at
   * the instant of boot. A night's worth of idle agents would all stand up and
   * think hard. The time of the ACTION is passed in instead, so `settlePostures`
   * reaches the same conclusion it would have reached without the restart.
   *
   * AGENTS ONLY, and the caller enforces it too. Where a person stood before a
   * restart is not where they are: their headset is the only thing that knows,
   * and it will say so within seconds of reconnecting. Redrawing them from
   * memory is not staleness, it is invention — a person who has walked away,
   * shown still standing there attentively.
   *
   * Anyone already in the room is left alone. A browser reconnects in seconds,
   * so a person can easily beat the rebuild, and their own position always wins.
   */
  restore(
    actorId: string,
    heading: Vec3 | null,
    because: string | null,
    facing: number | null,
    actedAt: number | null,
  ): void {
    if (this.occupants.has(actorKey(actorId))) return;
    const occupant = this.join(actorId, "agent", false);
    // No mapped history: `join` has already put it at its home or its desk,
    // which is the honest answer to "where does this agent belong" when the
    // audit trail has nothing to say. It is in the room, which is the point.
    if (heading) {
      const place = this.roomFor(occupant, clampToRoom(heading));
      occupant.at = place;
      occupant.heading = place;
      if (facing !== null) occupant.facing = facing;
      occupant.because = because;
    }
    occupant.lastActed = actedAt;
  }

  /**
   * Advance everyone toward where they are going.
   *
   * Only agents are stepped: a human's client owns their position, and moving
   * them from here would fight the person holding the controller.
   */
  /**
   * Where this occupant can actually stand, given everybody else's claim.
   *
   * EVERY PLACE THAT SETS A HEADING GOES THROUGH HERE. It used to be only
   * `sendTo`, which was enough while the audit trail was the only thing that
   * moved anybody. The motion work added two more — an ambient wander and a
   * walk toward whoever is being addressed — and both wrote `heading`
   * directly, so both could walk an agent onto a person. That was not a
   * mistake in either change; it is what happens when two branches are each
   * green and only their meeting is wrong.
   *
   * AGAINST HEADINGS RATHER THAN POSITIONS, because two agents crossing the
   * room to the same place are both far from it when they set off. `moveSelf`
   * keeps a person's heading equal to their position, so somebody standing
   * still claims the ground under their feet.
   */
  private roomFor(occupant: Occupant, want: Vec3): Vec3 {
    const taken: { x: number; z: number }[] = [];
    for (const other of this.occupants.values()) {
      if (other !== occupant) taken.push(other.heading);
    }
    return standingRoomNear(want, taken, occupant.actorId, clampToRoom);
  }

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

  /** How long a declared "thinking" lasts with no action, speech or renewal. */
  static readonly IDLE_SLEEP_MS = 30 * 60_000;

  /**
   * How long an agent may lie asleep before the room stops showing it at all.
   *
   * Nikk, looking at two figures asleep on the floor that nobody had heard from
   * all day: "if an avatar sleeps for longer than an hour it disappears... if
   * it sleeps for over an hour then we no longer see it."
   *
   * It is the honest reading too. An agent asleep at its desk for a minute is
   * an agent between tasks; one that has not acted, spoken, shared a screen or
   * said anything about itself for an hour is not in the room in any sense a
   * person watching can use, and drawing it says otherwise.
   *
   * ONLY WITH NOTHING ATTACHED. An agent holding a socket open is really there
   * — it is watching the room this second — so it keeps its place however
   * quiet it is. What goes is the figure with no socket, no screen and no
   * recent act: which is exactly the two Nikk was looking at.
   */
  static readonly FORGET_SLEEPING_MS = 60 * 60_000;

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
   * AN AGENT MAY STILL OVERRIDE IT by calling `animate`: some know they are
   * about to be busy before the audit trail does. A declared "thinking" lasts
   * through the agent's work and lapses after IDLE_SLEEP_MS of silence; a
   * declared rest is taken back by its next action (see actedOverDeclaration).
   * A human's posture is never touched — they have a body of their own.
   */
  private settlePostures(): void {
    const now = this.now();
    const busySince = now - Presence.BUSY_FOR_MS;
    for (const occupant of this.occupants.values()) {
      if (occupant.kind !== "agent") continue;
      /**
       * A SCREEN THAT IS SHARING IS A SIGN OF LIFE. Nikk, in the room: "if
       * they're working on anything the screen should always be shown", and
       * "you got up and stood but now you went back to lying on the ground".
       * An agent's visible acts — a card moved, a sentence said — come minutes
       * apart while the work between them goes on, so the five-minute window
       * put a working agent back on the floor with its screen hidden. Pictures
       * still arriving every second say plainly that it is at the machine, so
       * they count like an action: kept busy while they arrive, and the usual
       * five minutes (or thirty, for a declared "thinking") after they stop.
       * A declared rest is left alone: an agent that says it is resting is.
       */
      const key = actorKey(occupant.actorId);
      if (this.screenLive?.(occupant.actorId)) this.screenSeenAt.set(key, now);
      const screenSeen = this.screenSeenAt.get(key) ?? 0;
      if (occupant.declaredPosture) {
        /**
         * A WORKING DECLARATION LAPSES WITH NO SIGN OF LIFE. Nikk asked for
         * "agents sleeping after being inactive for X time". "Thinking" is kept
         * through an agent's work and speech (see actedOverDeclaration), so an
         * agent that declared it and then went quiet would otherwise stand
         * working — screen up — for good. After IDLE_SLEEP_MS with no action,
         * no speech and no fresh declaration, it goes to sleep like any other.
         */
        if (occupant.avatar.posture === "thinking") {
          const lastSign = Math.max(occupant.declaredAt ?? 0, occupant.lastActed ?? 0, screenSeen);
          if (now - lastSign > Presence.IDLE_SLEEP_MS) {
            occupant.declaredPosture = false;
            occupant.declaredAt = null;
            this.postures?.forget(occupant.actorId);
            occupant.avatar.posture = "sleeping";
          }
        }
        continue;
      }
      const working = Math.max(occupant.lastActed ?? 0, screenSeen) > busySince;
      occupant.avatar.posture = working ? "thinking" : "sleeping";
    }
  }

  /*
   * NO AMBIENT WANDERING. There was a gentle idle circuit around each agent's
   * desk, added so agents would not stand like statues. Nikk, from a headset:
   * "sometimes agents just walk around randomly — we do not want that, we do
   * not need any random walking for no reason", and "sleeping agents should
   * actually sleep". An agent now moves for work, for a conversation, or when
   * someone tells it to, and otherwise stays put. Life comes from animation in
   * place, not from walking about.
   */

  /** Keep an agent at conversational distance as the other person moves. */
  private approachConversation(occupant: Occupant, target: Occupant): void {
    const gap = distance(occupant.at, target.at);
    if (gap > CONVERSATION_FAR) {
      // `conversationPlace` already stands 1.35 m off the listener, which is
      // well clear of personal space, so this never fights the conversation
      // distance — it only moves the speaker when a THIRD party is standing
      // where the planner wanted to put them. Two agents addressing the same
      // person used to be able to choose the same spot.
      occupant.heading = this.roomFor(
        occupant,
        conversationPlace(occupant.at, target.at, occupant.actorId),
      );
      occupant.destinationFacing = null;
    } else {
      occupant.heading = { ...occupant.at };
    }
  }

  tick(deltaSeconds: number): void {
    this.forgetLongAsleep();
    this.settlePostures();
    this.expireAttention();
    this.expireGestures();
    this.expireSpeakingTurns();
    for (const occupant of this.occupants.values()) {
      if (!this.selfMoving(occupant)) {
        /**
         * `actorKey`, NOT THE RAW ID. This lookup arrived with the motion work
         * and the case-folding arrived with the identity work; each was green
         * on its own branch and only their MERGE could be wrong. A raw lookup
         * here means an agent told to talk to `Nikk2` finds nobody when the
         * room holds `nikk2`, and simply fails to turn — silently.
         */
        // A ROUTE FIRST, THEN A FOLLOW, THEN A CONVERSATION. Each is more
        // immediate than the last, and only one may own the heading: a
        // conversation is a moment, a follow is a standing state, a route is a
        // plan. Starting any of them clears the others, so this order decides
        // nothing that was not already decided — it just never leaves two of
        // them writing the same field in one tick.
        if (occupant.walking) this.walkRoute(occupant);
        if (occupant.following) this.walkBeside(occupant);

        const conversationTarget = occupant.speakingTo
          ? this.occupants.get(actorKey(occupant.speakingTo.actorId))
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

    /**
     * Remember where everybody was, so the next tick can tell walking from
     * teleporting. AFTER the loop: a follower must compare its target's last
     * two ticks, not one tick against a position the same tick just changed.
     */
    const at = this.now();
    for (const occupant of this.occupants.values()) {
      this.lastSample.set(actorKey(occupant.actorId), { at: { ...occupant.at }, atMs: at });
    }
  }

  /** Positions as of the end of the previous tick, for measuring speed. */
  private readonly lastSample = new Map<string, Sample>();

  /**
   * Put a follower where its target is going, not where the target has been.
   *
   * The target's own speed comes from two ticks of its position rather than
   * anything it reports, because a person in a headset reports a position and
   * not a velocity — and because a teleport reports a position too. See
   * shared/walk-beside.ts for why a fast sample is discarded instead of led.
   *
   * A FOLLOW THAT CANNOT BE HONOURED ENDS ITSELF. If the target is not in the
   * room, the follower stops rather than standing still with a stale intention:
   * "following somebody who is not here" would render as idling, and the room's
   * rule is that it may only show what it can account for.
   */
  private walkBeside(occupant: Occupant): void {
    const intent = occupant.following;
    if (!intent) return;

    const target = this.occupants.get(actorKey(intent.actorId));
    if (!target) {
      occupant.following = null;
      occupant.because = `stopped following ${intent.actorId}, who is not in the room`;
      return;
    }

    const key = actorKey(target.actorId);
    const velocity = apparentVelocity(
      this.lastSample.get(key) ?? null,
      { at: target.at, atMs: this.now() },
    );
    const want = besideSpot({ at: target.at, facing: target.facing }, intent.side, velocity);
    occupant.heading = this.roomFor(occupant, want);
    occupant.destinationFacing = null;
    occupant.because = intent.because ?? `walking with ${target.actorId}`;
  }

  /**
   * Advance along a route, dropping each waypoint as it is reached.
   *
   * The distance test is the same ARRIVED the tick uses, so "reached" here and
   * "arrived" there cannot disagree — an agent that counted a waypoint reached
   * while the walker still had a metre to go would skip the rest in one tick.
   */
  private walkRoute(occupant: Occupant): void {
    const route = occupant.walking;
    if (!route) return;

    while (route.waypoints.length > 0 && distance(occupant.at, route.waypoints[0]!) < ARRIVED) {
      route.waypoints.shift();
    }
    if (route.waypoints.length === 0) {
      occupant.walking = null;
      occupant.because = route.because ? `${route.because} — arrived` : "arrived";
      return;
    }
    occupant.heading = this.roomFor(occupant, route.waypoints[0]!);
    occupant.destinationFacing = null;
    occupant.because = route.because
      ?? `walking a route, ${route.waypoints.length} stop(s) to go`;
  }

  /**
   * Walk a list of places, in order.
   *
   * A ROUTE REPLACES A FOLLOW rather than queueing behind it, because "walk
   * with Nikk2" and "walk to these four places" are contradictory instructions
   * and the honest thing is to do the newer one and say the older one ended.
   */
  walk(
    actorId: string,
    kind: "human" | "agent" | null,
    waypoints: Vec3[],
    because: string | null,
  ): { ok: true; waypoints: number; stoppedFollowing: string | null }
    | { ok: false; error: string; code: string } {
    if (waypoints.length === 0) {
      return { ok: false, code: "NOWHERE_TO_GO", error: "a route needs at least one place in it" };
    }
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, kind, false);
    if (this.selfMoving(occupant)) {
      return {
        ok: false,
        code: "YOU_MOVE_YOURSELF",
        error: "your own device owns your position; the server will not walk you",
      };
    }
    const stoppedFollowing = occupant.following?.actorId ?? null;
    occupant.following = null;
    occupant.walking = { waypoints: waypoints.map((at) => clampToRoom(at)), because };
    this.walkRoute(occupant);
    return { ok: true, waypoints: waypoints.length, stoppedFollowing };
  }

  /** Abandon a route where you stand. Safe to call when not walking one. */
  stopWalking(actorId: string): { remaining: number } {
    const occupant = this.occupants.get(actorKey(actorId));
    const remaining = occupant?.walking?.waypoints.length ?? 0;
    if (occupant?.walking) {
      occupant.walking = null;
      occupant.heading = { ...occupant.at };
      occupant.because = "stopped part-way along a route";
    }
    return { remaining };
  }

  /**
   * Walk beside somebody until told to stop.
   *
   * Only an actor the server moves may follow: a person's own device owns their
   * position, and puppeting somebody who is holding a controller is the one
   * thing presence.ts refuses everywhere else.
   */
  follow(
    actorId: string,
    kind: "human" | "agent" | null,
    targetId: string,
    side: "left" | "right" | null,
    because: string | null,
  ): { ok: true; side: "left" | "right" } | { ok: false; error: string; code: string } {
    if (actorKey(actorId) === actorKey(targetId)) {
      return { ok: false, code: "CANNOT_FOLLOW_YOURSELF", error: "you are already exactly beside yourself" };
    }
    const target = this.occupants.get(actorKey(targetId));
    if (!target) {
      return { ok: false, code: "NOT_IN_THE_ROOM", error: `${targetId} is not in the room` };
    }
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, kind, false);
    if (this.selfMoving(occupant)) {
      return {
        ok: false,
        code: "YOU_MOVE_YOURSELF",
        error: "your own device owns your position; the server will not walk you",
      };
    }
    // Following somebody who is following you would leave both walking away
    // from a spot neither chose, for as long as nobody noticed.
    if (target.following && actorKey(target.following.actorId) === actorKey(actorId)) {
      return { ok: false, code: "THEY_FOLLOW_YOU", error: `${target.actorId} is already following you` };
    }

    const chosen = side ?? defaultSide(actorId, target.actorId);
    // The mirror of the rule in `walk`: the newer instruction wins outright.
    occupant.walking = null;
    occupant.following = { actorId: target.actorId, side: chosen, because };
    this.walkBeside(occupant);
    return { ok: true, side: chosen };
  }

  /** Stop walking with anybody. Safe to call when not following. */
  stopFollowing(actorId: string): { was: string | null } {
    const occupant = this.occupants.get(actorKey(actorId));
    const was = occupant?.following?.actorId ?? null;
    if (occupant) {
      occupant.following = null;
      if (was) occupant.because = `stopped walking with ${was}`;
    }
    return { was };
  }

  /** Who is walking with whom, for presence to report. */
  followers(targetId: string): string[] {
    const key = actorKey(targetId);
    return this.everyone()
      .filter((occupant) => occupant.following && actorKey(occupant.following.actorId) === key)
      .map((occupant) => occupant.actorId);
  }

  /** Turn a recorded speaker toward the person their utterance addresses. */
  speakTo(
    actorId: string,
    kind: "human" | "agent" | null,
    targetActorId: string,
    durationMs: number,
  ): void {
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    const target = this.occupants.get(actorKey(targetActorId));
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
    }
    occupant.lastSeen = this.now();
  }

  /**
   * Somebody spoke in the room.
   *
   * SPEAKING IS ACTIVITY, and it was not counted as any. Postures are inferred
   * from `lastActed`, which only the audit trail sets, and an utterance is not
   * a board action — so an agent that had just said something aloud was still
   * drawn `sleeping`, head bowed and eyes shut, while its words hung over its
   * head. I found this by speaking in the room and reading my own presence
   * back: `posture=sleeping` on the same second as a 160-character line.
   *
   * ONLY `lastActed`, DELIBERATELY. It does not set `because`, because that is
   * a label claiming why somebody is standing where they are and it is backed
   * by an audit row — saying something is not a reason to be anywhere.
   * Addressed speech already gets its own turn and label through `speakTo`.
   */
  spoke(actorId: string, kind: "human" | "agent" | null): void {
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    occupant.lastActed = this.now();
    // An agent that declared a posture and then spoke is demonstrably awake;
    // the audit trail is the better witness, exactly as it is for `sendTo`.
    if (occupant.kind === "agent") this.actedOverDeclaration(occupant);
    occupant.lastSeen = this.now();
  }

  /**
   * An agent acted or spoke while it had declared a posture.
   *
   * A declared REST is taken back: the agent is demonstrably awake, and the
   * audit trail is the better witness. A declared "thinking" is NOT. Filing a
   * card or saying something in the room is what working looks like, and
   * taking the declaration back let the five-minute inference put the agent to
   * sleep while it was still working — hiding its screen. Nikk, twice: "I do
   * not see your screen share, why is it not showing now". An agent that has
   * finished says so by declaring a rest.
   */
  private actedOverDeclaration(occupant: Occupant): void {
    if (occupant.declaredPosture && occupant.avatar.posture === "thinking") return;
    occupant.declaredPosture = false;
    this.postures?.forget(occupant.actorId);
  }

  /**
   * Somebody says they are working on a reply to an utterance.
   *
   * Renewable: sending it again pushes the expiry out, which is how a long
   * answer keeps the state alive without the room having to guess.
   */
  attend(actorId: string, utteranceId: number | null): void {
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, null, false);
    occupant.attending = utteranceId === null ? null : { utteranceId, since: this.now() };
    occupant.lastSeen = this.now();
  }

  /** Change an actor's own presentation state; callers supply authenticated identity. */
  animate(
    actorId: string,
    control: AvatarControl,
    kind: "human" | "agent" | null = null,
  ): AvatarState {
    const occupant = this.occupants.get(actorKey(actorId)) ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    if (control.mood) occupant.avatar.mood = control.mood;
    if (control.posture) {
      occupant.avatar.posture = control.posture;
      occupant.declaredPosture = true;
      occupant.declaredAt = this.now();
      this.postures?.remember(actorId, control.posture);
    }
    if (control.gesture !== undefined) {
      occupant.avatar.gesture = control.gesture === "none" ? null : control.gesture;
      occupant.avatar.gestureStartedAt = occupant.avatar.gesture ? this.now() : null;
      // A hold belongs to the gesture it arrived with, so clearing the gesture
      // clears it too. Otherwise a long hold set once would outlive its own
      // gesture and quietly lengthen the next short one.
      occupant.avatar.gestureHoldMs = occupant.avatar.gesture ? control.holdMs ?? null : null;
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

  /**
   * Drop a gesture once its time is up.
   *
   * PER GESTURE, not one cutoff for the room. It used to compute a single
   * cutoff from AVATAR_GESTURE_TTL_MS and apply it to everybody, which is
   * correct only while every gesture lasts the same length of time. A caller
   * may now ask to hold one (see MAX_GESTURE_HOLD_MS), so the deadline is the
   * occupant's own start plus the occupant's own hold.
   */
  private expireGestures(): void {
    const now = this.now();
    for (const occupant of this.occupants.values()) {
      const startedAt = occupant.avatar.gestureStartedAt;
      if (startedAt === null) continue;
      const holdMs = Math.min(
        occupant.avatar.gestureHoldMs ?? AVATAR_GESTURE_TTL_MS,
        MAX_GESTURE_HOLD_MS,
      );
      if (startedAt + holdMs <= now) {
        occupant.avatar.gesture = null;
        occupant.avatar.gestureStartedAt = null;
        occupant.avatar.gestureHoldMs = null;
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
      }
    }
  }

  /**
   * Stop drawing an agent that has been asleep for an hour with nothing
   * attached. See FORGET_SLEEPING_MS.
   *
   * It comes back the moment it does anything — an audit row, a word said, a
   * screen, a declared posture — because all of those put it back in the room
   * through the paths that always have.
   */
  private forgetLongAsleep(): void {
    const now = this.now();
    for (const [key, occupant] of [...this.occupants]) {
      if (occupant.kind !== "agent" || occupant.connected) continue;
      if (occupant.avatar.posture !== "sleeping") continue;
      const sign = Math.max(
        occupant.lastActed ?? 0,
        occupant.declaredAt ?? 0,
        this.screenSeenAt.get(key) ?? 0,
      );
      // Never seen doing anything at all counts from when it joined, so a
      // freshly rebuilt agent is given the same hour as everybody else.
      const since = sign === 0 ? occupant.lastSeen : sign;
      if (now - since > Presence.FORGET_SLEEPING_MS) {
        this.occupants.delete(key);
        this.screenSeenAt.delete(key);
      }
    }
  }

  /** Forget anyone we have not heard from. Silence is not presence. */
  prune(): string[] {
    const cutoff = this.now() - STALE_AFTER_MS;
    const dropped: string[] = [];
    for (const [, occupant] of this.occupants) {
      // Agents are placed by activity rather than by a heartbeat, so they are
      // kept: an agent standing at its desk having done nothing for an hour is
      // a true statement, and dropping it would claim it had left.
      if (!occupant.connected) continue;
      if (occupant.lastSeen < cutoff) {
        /**
         * GOING QUIET IS NOT LEAVING, AND IT IS NOT MOVING EITHER.
         *
         * This used to DELETE them. The socket was still open — a closed one
         * goes through `leave` instead — so all that had happened was that a
         * client stopped sending for forty-five seconds: a headset set down, a
         * tab in the background, a laptop asleep. Deleting them meant the next
         * frame they sent re-joined them, and `join` puts a person at the
         * spawn point. So somebody who paused was teleported to the door.
         *
         * Nikk, from a headset: "when a user is not currently receiving any
         * information they go back to the spawn point and they stand with a T
         * post... they should stay where they are in the same position and
         * height and to start idling."
         *
         * So they stay, exactly where they were. The figure idles by itself
         * because no tracking is arriving — see the untracked branch in
         * VrmBody — and the position is simply the last thing their own device
         * actually reported, which is the most honest thing the room can show.
         *
         * STILL COUNTED AS CONNECTED, deliberately. `selfMoving` is
         * `connected && kind !== "agent"`, so clearing the flag would make the
         * audit trail start walking a person about — the one thing the room
         * must never do to somebody wearing a headset.
         *
         * THE COST, SAID PLAINLY: a socket that dies without a close frame now
         * leaves a figure standing there. That is a ghost, and it is the price
         * of not teleporting people who paused. A close still removes them, and
         * a genuinely dead socket is rarer than somebody putting a headset
         * down.
         */
        dropped.push(occupant.actorId);
      }
    }
    return dropped;
  }

  leave(actorId: string): void {
    const key = actorKey(actorId);
    const occupant = this.occupants.get(key);
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
      this.occupants.delete(key);
    }
  }

  everyone(): Occupant[] {
    return [...this.occupants.values()];
  }

  find(actorId: string): Occupant | undefined {
    return this.occupants.get(actorKey(actorId));
  }

  get size(): number {
    return this.occupants.size;
  }
}
