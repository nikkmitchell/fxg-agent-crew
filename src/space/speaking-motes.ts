/**
 * A slow pulse of light rising off whoever is speaking.
 *
 * Nikk: "I would like to add in some kind of particle effects that go over top
 * of an agent while they're speaking, something that's pulsing out of them that
 * happens while the voice thing is playing".
 *
 * The rules are here and tested; SpeakingMotes draws them, the same split as
 * arrival-sparkle.ts and for the same reason — a burst somebody can see is not
 * a burst anybody can assert anything about.
 *
 * WHY NOT ASK WHETHER AUDIO IS PLAYING. Only the client that plays a line knows
 * when the audio starts and stops, and a wearer with sound off would then see
 * nobody speaking at all. The room broadcasts every utterance to everybody, so
 * the visible signal is "X said this line, just now", which is true whether or
 * not your speakers are on — and it is the thing Nikk actually wants to see: who
 * is talking.
 *
 * HOW LONG, AND WHERE THE NUMBER COMES FROM. A measured one, not a guess: on
 * 2026-09-19 utterance 286 was 128 characters and the box rendered 8.83 seconds
 * of audio for it, 24 kHz mono — 14.5 characters per second. So a line's length
 * predicts how long it is spoken for, close enough for a light that fades.
 */

/** Characters per second, measured from a real Kokoro rendering. See above. */
export const SPEECH_CHARS_PER_SECOND = 14.5;

/** Nothing shorter than this, so a two-word line still registers as a pulse. */
const SHORTEST_S = 1.2;

/**
 * And nothing longer, however long the line. A `say` is capped at 240
 * characters (SPOKEN_LIMIT), so the honest ceiling is that read aloud — past it
 * something has gone wrong and a light that never goes out is worse than one
 * that stops early.
 */
const LONGEST_S = 20;

/** How long to show somebody as speaking, from the line they said. */
export function speakingSeconds(say: string): number {
  const said = say.trim();
  if (!said) return 0;
  return Math.min(LONGEST_S, Math.max(SHORTEST_S, said.length / SPEECH_CHARS_PER_SECOND));
}

export type SpeakingLine = {
  /** The utterance id, so the same line is never started twice. */
  id: number;
  actorId: string;
  say: string | null;
};

/**
 * Whether this utterance should start a pulse on this client, and for how long.
 *
 * NOT YOUR OWN VOICE. You know when you are talking; a light on your own chest
 * is noise, and in a headset it is in the way.
 *
 * NOT A LINE WITH NOTHING SPOKEN. An utterance can carry only `detail` — written
 * and never said — and lighting somebody up for words nobody hears would be the
 * room claiming something that did not happen.
 */
export function pulseFor(
  line: SpeakingLine | null,
  you: string | null,
  alreadyStarted: number | null,
): { actorId: string; seconds: number } | null {
  if (!line || line.id === alreadyStarted) return null;
  if (you && line.actorId.toLowerCase() === you.toLowerCase()) return null;
  const seconds = speakingSeconds(line.say ?? "");
  if (seconds <= 0) return null;
  return { actorId: line.actorId, seconds };
}

/** Deterministic pseudo-random numbers, so a pulse is testable. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/**
 * The height a mote wraps back to the bottom at, so the column never empties.
 * Above the head of a figure — the arrival burst puts hands at 0.75 — so the
 * light carries on past somebody rather than stopping at their chest.
 */
export const COLUMN_TOP = 1.7;

export const MOTE_COUNT = 36;

/**
 * Where the motes start and how they drift: a loose column around the speaker,
 * rising. UPWARD ONLY and slowly — this runs for as long as somebody is
 * talking, where the arrival burst is over in 1.4 seconds. A fountain that went
 * on for eight seconds beside your face would be a nuisance rather than a cue.
 */
export function moteField(seed: number, count = MOTE_COUNT): { positions: Float32Array; rise: Float32Array } {
  const next = random(seed);
  const positions = new Float32Array(count * 3);
  const rise = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = next() * Math.PI * 2;
    /**
     * AROUND THE FIGURE, NOT THROUGH IT — a radius that clears the body, and a
     * column that carries on above the head.
     *
     * HOW THIS NUMBER WAS NOT ARRIVED AT, since the first version of this
     * comment claimed otherwise. I widened it from 0.12-0.34 after "seeing"
     * motes buried in a speaker's body in the room harness. I had seen no such
     * thing: the harness serves the BUILT bundle, I had not run vite build, and
     * what I was looking at was the speaker's own avatar markings. The stale
     * page could not have contained this file at all.
     *
     * The geometry below IS verified, against a build that contains it: the
     * motes stand clear of the figure, rise past the head, appear only on the
     * speaker and stop when the line does.
     */
    const radius = 0.26 + next() * 0.22;
    positions[i * 3] = Math.cos(angle) * radius;
    // Spread through the column at the start, so it does not begin as a disc.
    positions[i * 3 + 1] = next() * COLUMN_TOP;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    rise[i] = 0.16 + next() * 0.26;
  }
  return { positions, rise };
}

/** Advance the motes by `dt` seconds: drift up, and start again from the feet. */
export function stepMotes(positions: Float32Array, rise: Float32Array, dt: number): void {
  for (let i = 0; i < rise.length; i += 1) {
    positions[i * 3 + 1] += rise[i] * dt;
    if (positions[i * 3 + 1] > COLUMN_TOP) positions[i * 3 + 1] -= COLUMN_TOP;
  }
}

/**
 * How visible the pulse is, `age` seconds into a line of `seconds`.
 *
 * Fades in and out rather than snapping, and PULSES while it lasts — that is
 * the word Nikk used, and a steady glow reads as a status light rather than as
 * somebody talking.
 */
export function moteOpacity(age: number, seconds: number): number {
  if (age < 0 || age >= seconds) return 0;
  const edge = Math.min(0.35, seconds / 4);
  const inAt = Math.min(1, age / edge);
  const outAt = Math.min(1, (seconds - age) / edge);
  const pulse = 0.72 + 0.28 * Math.sin(age * 6.2);
  return Math.max(0, Math.min(1, inAt * outAt * pulse));
}
