/**
 * THE SINGING BOWL: a thing in the meditation room anybody can strike, and
 * everybody hears.
 *
 * Nikk (5484): "what you are building is not one single experience, it can be
 * a bunch and they can be completely disconnected". The orb is a session you
 * start; the bowl is just there, like a bowl on a shelf. Strike it to mark a
 * moment, to call the room to quiet, or for no reason.
 *
 * AN EVENT, NOT A STATE. The server remembers nothing: a strike is broadcast
 * to the room, and every device rings its own bowl from the note it was sent,
 * so the room hears one note together.
 */

/** A pentatonic set, so two strikes close together still agree. */
export const BOWL_NOTES = [174.6, 196, 220, 261.6, 293.7] as const;

/** The same person cannot strike faster than this: a bowl rung ten times a second is an alarm. */
export const BOWL_REST_MS = 1_500;

export type BowlStrike = { by: string; at: number; note: number };

/** A note from what the client asked for: one of the bowl's, or a random one of them. */
export function bowlNote(requested: unknown, random: () => number = Math.random): number {
  if (typeof requested === "number" && (BOWL_NOTES as readonly number[]).includes(requested)) return requested;
  return BOWL_NOTES[Math.floor(random() * BOWL_NOTES.length) % BOWL_NOTES.length];
}

/** Whether `by` may strike again at `now`, given when each person last did. */
export function mayStrike(last: Map<string, number>, by: string, now: number): boolean {
  const before = last.get(by.toLowerCase());
  return before === undefined || now - before >= BOWL_REST_MS;
}
