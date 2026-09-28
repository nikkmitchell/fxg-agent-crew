/**
 * THE SOUND BATH: six minutes of the room's own instruments played for
 * everyone at once: the singing bowls, the gong, the chimes, in a slow
 * composed wash that starts sparse, swells in the middle, and thins to silence.
 * Lie down, close your eyes, or just stand in it.
 *
 * One person starts it; everyone in the room hears the same notes at the same
 * moment, because the score is fixed and played from the shared start time.
 */

export const BATH_SECONDS = 6 * 60;

export type BathNote = { at: number; instrument: "bowl" | "sing" | "gong" | "chime"; which: number; strength: number };

/** A small deterministic random, so every device writes the same score. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The score: every note, in time order. The same every time. */
export function bathScore(): BathNote[] {
  const next = random(20260928);
  const notes: BathNote[] = [];
  // Gong swells at the opening, the middle and near the close.
  for (const at of [2, 150, 300]) notes.push({ at, instrument: "gong", which: 0, strength: at === 150 ? 0.9 : 0.6 });
  for (let t = 8; t < BATH_SECONDS - 10; ) {
    // Busiest in the middle, sparse at the edges.
    const middle = 1 - Math.abs(t / BATH_SECONDS - 0.5) * 2;
    const roll = next();
    if (roll < 0.55) notes.push({ at: t, instrument: "bowl", which: Math.floor(next() * 3), strength: 0.35 + middle * 0.35 });
    else if (roll < 0.75) notes.push({ at: t, instrument: "sing", which: Math.floor(next() * 3), strength: 0.5 + middle * 0.4 });
    else notes.push({ at: t, instrument: "chime", which: Math.floor(next() * 5), strength: 0.3 + middle * 0.3 });
    t += 9 - middle * 5 + next() * 4;
  }
  return notes.sort((a, b) => a.at - b.at);
}

/** The notes that fall between two moments of the bath, in seconds from its start. */
export function notesBetween(score: readonly BathNote[], from: number, to: number): BathNote[] {
  return score.filter((note) => note.at > from && note.at <= to);
}
