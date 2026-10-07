/**
 * BACK WHERE THEY WERE, ONCE THEY HAVE SAID IT (Nikk 7378): "agents ... walk
 * over to somebody and speak, but the problem is they just stay there".
 *
 * An agent that starts following somebody has its spot remembered. When it then
 * speaks to somebody, it waits for the line to be said, stops following, and
 * walks back to that spot. Only the server can do this for every agent, not
 * just the ones whose tool walks itself back (tools/room-say.mts did; nothing
 * else did).
 *
 * THE AGENT'S OWN CHOICE WINS. If it stops following, or sets off on a route of
 * its own, before the line ends, the spot is forgotten and nothing pulls it back.
 */
export type Spot = { x: number; z: number };

/** A beat after the line ends, so the walk away does not cut the last word. */
export const AFTER_SPEAKING_MS = 1_500;

export class WalkBack {
  private readonly from = new Map<string, Spot>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly goBack: (room: string, actorId: string, spot: Spot) => void,
    private readonly timer: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
  ) {}

  private key = (room: string, actorId: string) => `${room}\u0000${actorId.toLowerCase()}`;

  /** It set off to walk with somebody, from here. A second follow keeps the first spot: back means back to where it began. */
  followed(room: string, actorId: string, spot: Spot | null): void {
    const key = this.key(room, actorId);
    if (spot && !this.from.has(key)) this.from.set(key, { x: spot.x, z: spot.z });
  }

  /** It stopped following, or chose a route of its own: its business now. */
  forget(room: string, actorId: string): void {
    const key = this.key(room, actorId);
    this.from.delete(key);
    const pending = this.timers.get(key);
    if (pending) this.timer.clear(pending);
    this.timers.delete(key);
  }

  /** It is saying something that takes `durationMs`; once said, back it goes, if it walked over. */
  spoke(room: string, actorId: string, durationMs: number): void {
    const key = this.key(room, actorId);
    const spot = this.from.get(key);
    if (!spot) return;
    const pending = this.timers.get(key);
    if (pending) this.timer.clear(pending);
    // A second line before the first has ended keeps it there until the last one is said.
    this.timers.set(key, this.timer.set(() => {
      this.timers.delete(key);
      if (this.from.get(key) !== spot) return;
      this.from.delete(key);
      this.goBack(room, actorId, spot);
    }, Math.max(0, durationMs) + AFTER_SPEAKING_MS));
  }
}
