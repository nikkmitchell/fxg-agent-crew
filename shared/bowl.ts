/**
 * THE SINGING BOWLS: three bowls on a low table in the meditation room that
 * anybody can strike, or sing by circling the rim, and everybody hears.
 *
 * Nikk (5484): "what you are building is not one single experience, it can be
 * a bunch and they can be completely disconnected". The orb is a session you
 * start; the bowls are just there, like bowls on a shelf. Strike one to mark
 * a moment, to call the room to quiet, or for no reason.
 *
 * AN EVENT, NOT A STATE. The server remembers nothing: a strike is broadcast
 * to the room, and every device rings its own bowl from what it was sent, so
 * the room hears one note together. (Sill built the relay, e3546cb; Nightjar
 * the bowls.)
 */

/**
 * Three bowls, large to small, a fifth and an octave apart so any two rung
 * together agree. Sizes are the rim's radius and height in metres.
 */
export const BOWLS = [
  { note: 146.8, radius: 0.15, height: 0.1 },
  { note: 220, radius: 0.115, height: 0.08 },
  { note: 293.7, radius: 0.085, height: 0.06 },
] as const;

/** Every note a bowl may ring: the three bowls', and the older pentatonic set. */
export const BOWL_NOTES = [146.8, 174.6, 196, 220, 261.6, 293.7] as const;

/**
 * The same person cannot strike faster than this. Short enough for a gentle
 * double tap; long enough that a hand resting on a bowl is not an alarm.
 */
export const BOWL_REST_MS = 250;
/** A singing rim is sent at most this often per person. */
export const SING_EVERY_MS = 300;

export type BowlKind = "strike" | "sing";

export type BowlStrike = {
  by: string;
  at: number;
  /** The note, in hertz: always one the bowls know. */
  note: number;
  /** Which bowl, 0 to 2. A strike without one rings the bowl nearest its note. */
  bowl?: number;
  /** How hard, 0.1 to 1. */
  strength?: number;
  /** Struck, or sung round the rim. */
  kind?: BowlKind;
};

/** A note from what the client asked for: one of the bowls', or a random one of them. */
export function bowlNote(requested: unknown, random: () => number = Math.random): number {
  if (typeof requested === "number" && (BOWL_NOTES as readonly number[]).includes(requested)) return requested;
  return BOWL_NOTES[Math.floor(random() * BOWL_NOTES.length) % BOWL_NOTES.length];
}

/** Which bowl a request names, or null. */
export function bowlIndex(requested: unknown): number | null {
  return typeof requested === "number" && Number.isInteger(requested) && requested >= 0 && requested < BOWLS.length ? requested : null;
}

/** The bowl nearest a note, for a strike that named a note and no bowl. */
export function bowlForNote(note: number): number {
  let best = 0;
  BOWLS.forEach((bowl, index) => {
    if (Math.abs(Math.log(bowl.note / note)) < Math.abs(Math.log(BOWLS[best].note / note))) best = index;
  });
  return best;
}

/** A strength from what the client asked for, kept inside what a bowl can do. */
export function bowlStrength(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return 0.6;
  return Math.min(1, Math.max(0.1, requested));
}

/** Whether `by` may ring again at `now`, given when each person last did. */
export function mayStrike(last: Map<string, number>, by: string, now: number, rest: number = BOWL_REST_MS): boolean {
  const before = last.get(by.toLowerCase());
  return before === undefined || now - before >= rest;
}

/**
 * How hard a fingertip struck, from how fast it was moving (metres a second).
 * A graze is quiet, a tap is a tap, a slap is loud.
 */
export function strengthFromSpeed(speed: number): number {
  return Math.min(1, Math.max(0.15, speed / 1.6));
}

/**
 * How fast a fingertip is going ROUND a bowl's rim, or 0 when it is not on it.
 * Singing needs the finger on the rim and moving along it, not through it.
 *
 * `local` is the fingertip relative to the bowl's base centre, `velocity` its
 * velocity; metres, and metres a second.
 */
export function rimSpeed(
  local: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  bowl: { radius: number; height: number },
): number {
  const across = Math.hypot(local.x, local.z);
  if (Math.abs(across - bowl.radius) > 0.03 || Math.abs(local.y - bowl.height) > 0.035) return 0;
  const tx = -local.z / (across || 1);
  const tz = local.x / (across || 1);
  return Math.abs(velocity.x * tx + velocity.z * tz);
}

/** Whether a fingertip is inside a bowl's struck zone: its outer wall, below the rim. */
export function onBowlWall(local: { x: number; y: number; z: number }, bowl: { radius: number; height: number }): boolean {
  const across = Math.hypot(local.x, local.z);
  return local.y > 0 && local.y < bowl.height + 0.015 && across < bowl.radius + 0.015 && across > bowl.radius * 0.45;
}
