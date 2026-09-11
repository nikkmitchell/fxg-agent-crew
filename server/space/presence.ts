import { ROOM, WALK_SPEED, type Vec3, deskFor } from "../../shared/space-layout.js";

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
  lastSeen: number;
};

/** Drop an occupant we have not heard from in this long. */
export const STALE_AFTER_MS = 45_000;

const clampToRoom = (at: Vec3): Vec3 => ({
  x: Math.max(-ROOM.width / 2 + 0.5, Math.min(ROOM.width / 2 - 0.5, at.x)),
  y: 0,
  z: Math.max(-ROOM.depth / 2 + 0.5, Math.min(ROOM.depth / 2 - 0.5, at.z)),
});

const distance = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);

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
      facing: 0,
      because: null,
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
  moveSelf(actorId: string, at: Vec3, facing: number): void {
    const occupant = this.occupants.get(actorId);
    if (!occupant) return;
    const clamped = clampToRoom(at);
    occupant.at = clamped;
    occupant.heading = clamped;
    occupant.facing = facing;
    occupant.because = null;
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
  sendTo(actorId: string, kind: "human" | "agent" | null, heading: Vec3, because: string | null): void {
    const existing = this.occupants.get(actorId);
    if (existing?.connected) return;
    const occupant = existing ?? this.join(actorId, kind, false);
    if (kind && !occupant.kind) occupant.kind = kind;
    occupant.heading = clampToRoom(heading);
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
    for (const occupant of this.occupants.values()) {
      if (occupant.connected) continue;
      const remaining = distance(occupant.at, occupant.heading);
      if (remaining < 0.02) {
        occupant.at = { ...occupant.heading };
        continue;
      }
      const step = Math.min(WALK_SPEED * deltaSeconds, remaining);
      const ratio = step / remaining;
      occupant.at = {
        x: occupant.at.x + (occupant.heading.x - occupant.at.x) * ratio,
        y: 0,
        z: occupant.at.z + (occupant.heading.z - occupant.at.z) * ratio,
      };
      // Face the way you are walking. Turning to face a wall you have arrived
      // at is the difference between standing at the board and standing near it.
      occupant.facing = Math.atan2(occupant.heading.x - occupant.at.x, occupant.heading.z - occupant.at.z);
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
