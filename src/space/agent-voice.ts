/**
 * Each agent sounds like itself, and sounds as near as it is.
 *
 * Nikk: "add in positional voice so that agents talk comes from where they
 * are, and users talk also comes from where they are, if possible using
 * current system text to speech allow for agents to have different voices".
 *
 * PEOPLE already come from where they stand: their microphones arrive as
 * streams and are played positioned in the room (SpatialVoices).
 *
 * AGENTS SPEAK THROUGH THE SYSTEM'S TEXT TO SPEECH, as asked, and that voice
 * cannot be placed in space: a browser gives a page no access to its audio,
 * only a volume, a pitch, a speed and a choice of voice. So this does the two
 * things that API allows:
 *
 *   - A VOICE OF ITS OWN. Each agent is given one of the system's voices for
 *     the page's language, and its own pitch and pace, chosen from its name —
 *     the same on every headset, and the same every day.
 *   - AS LOUD AS IT IS NEAR. Full volume within a couple of metres, fading with
 *     distance to a quiet floor at the far end of the room, so an agent across
 *     the room sounds across the room. Direction is the one thing it cannot do.
 */

export type VoiceChoice = { voiceIndex: number | null; pitch: number; rate: number };

const hash = (value: string): number =>
  [...value.trim().toLowerCase()].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16_777_619) >>> 0, 2_166_136_261);

/**
 * Which of `voices` an agent speaks with, and at what pitch and pace.
 * Voices for the page's language are preferred; with none, any voice; with
 * no voices at all, the system default (null) with the agent's own pitch.
 */
export function voiceFor(speaker: string, voices: { lang: string }[], language = "en"): VoiceChoice {
  const h = hash(speaker);
  const base = language.slice(0, 2).toLowerCase();
  const matching = voices.map((voice, index) => ({ voice, index })).filter(({ voice }) => voice.lang.toLowerCase().startsWith(base));
  const pool = matching.length > 0 ? matching : voices.map((voice, index) => ({ voice, index }));
  return {
    voiceIndex: pool.length > 0 ? pool[h % pool.length].index : null,
    // Pitch 0.8 to 1.25 and pace 0.92 to 1.08: distinct, never cartoonish.
    pitch: 0.8 + ((h >>> 8) % 1000) / 1000 * 0.45,
    rate: 0.92 + ((h >>> 18) % 1000) / 1000 * 0.16,
  };
}

export const NEAR_METRES = 2;
export const FAR_METRES = 14;
export const FAR_VOLUME = 0.2;

/** How loud a voice `metres` away should be: 1 up close, fading to a floor far off. */
export function volumeAt(metres: number | null): number {
  if (metres === null || !Number.isFinite(metres)) return 1;
  if (metres <= NEAR_METRES) return 1;
  if (metres >= FAR_METRES) return FAR_VOLUME;
  const t = (metres - NEAR_METRES) / (FAR_METRES - NEAR_METRES);
  return 1 - t * (1 - FAR_VOLUME);
}
