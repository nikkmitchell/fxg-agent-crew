/**
 * Which voice an agent speaks in.
 *
 * Nikk: "open source tts that has actual nice voices, that can be used by each
 * agent, so they can also choose a voice". The same shape as choosing a body,
 * and for the same reason: an agent picks a NAME, the server resolves it, and
 * nobody needs a commit to sound like themselves.
 *
 * THE VOICES ARE KOKORO-82M's, Apache 2.0 on both the model and the voice packs.
 * That licence is the reason this engine and not a better-scoring one: Chatterbox
 * clones a voice from five seconds of audio, which in a room whose premise is
 * that you can trust who said what is a liability rather than a feature, and
 * Coqui XTTS-v2 and ChatTTS are non-commercial — the same rule that keeps the
 * wardrobe to bodies whose own bytes say CC0.
 *
 * A NAME, NOT A FILE PATH, for the reason migration 22 gives about bodies: the
 * engine will change and the choice should not have to.
 */

/** A voice somebody can choose. */
export type Voice = {
  /** What an agent sends, e.g. "am_michael". Kokoro's own id. */
  id: string;
  /** How it is described to somebody choosing. Nobody has LISTENED to these yet. */
  blurb: string;
  language: "en-US" | "en-GB";
};

/**
 * The voices offered, and only ones this project can actually serve.
 *
 * DELIBERATELY A SUBSET of Kokoro's 54. The full set spans eight languages and
 * includes voices nobody here has heard; offering all of them would be a
 * catalogue of descriptions somebody wrote rather than a list of voices somebody
 * checked. Twelve English voices are more than the room has agents.
 *
 * WHAT NOBODY HAS DONE: listened to any of these. The blurbs are Kokoro's own
 * naming conventions (a/b = American/British, f/m = the voice's register as the
 * model ships it), NOT a description of how it sounds to an ear. The wardrobe
 * made exactly this mistake with `Crowley`, which the catalogue calls a crow and
 * which is plainly a fox once somebody looked. So each blurb says what it is
 * derived from, and `looked` stays null until a person says otherwise.
 */
export const VOICES: readonly Voice[] = [
  { id: "af_heart", blurb: "American, warm; Kokoro's default and its most-tested voice", language: "en-US" },
  { id: "af_bella", blurb: "American, bright", language: "en-US" },
  { id: "af_nicole", blurb: "American, quiet and close-miked", language: "en-US" },
  { id: "af_sarah", blurb: "American, even and unhurried", language: "en-US" },
  { id: "am_michael", blurb: "American, low and steady", language: "en-US" },
  { id: "am_adam", blurb: "American, plain and flat", language: "en-US" },
  { id: "am_fenrir", blurb: "American, dark", language: "en-US" },
  { id: "am_puck", blurb: "American, light and quick", language: "en-US" },
  { id: "bf_emma", blurb: "British, measured", language: "en-GB" },
  { id: "bf_isabella", blurb: "British, clipped", language: "en-GB" },
  { id: "bm_george", blurb: "British, older and deliberate", language: "en-GB" },
  { id: "bm_lewis", blurb: "British, gravelly", language: "en-GB" },
] as const;

/** Case-folded, like every other identifier here, because the room folds names. */
export const voiceKey = (id: string): string => id.trim().toLowerCase();

export type VoiceChoice =
  | { voice: Voice }
  | { error: string; code: "NO_SUCH_VOICE" | "NO_VOICE_GIVEN" };

/**
 * Resolve a requested voice, or say precisely what was wrong.
 *
 * NOT FOUND IS NOT "USE THE DEFAULT". An agent that asked for a voice and
 * silently got another would have no way to tell, and would spend an hour on the
 * wrong end of the mistake — which is the same failure as the gesture that was
 * accepted and never played.
 */
export function chooseVoice(requested: unknown, offered: readonly Voice[] = VOICES): VoiceChoice {
  if (typeof requested !== "string" || !requested.trim()) {
    return { code: "NO_VOICE_GIVEN", error: 'name a voice: {"voice":"am_michael"}' };
  }
  const wanted = voiceKey(requested);
  const found = offered.find((voice) => voiceKey(voice.id) === wanted);
  if (!found) {
    return {
      code: "NO_SUCH_VOICE",
      error: `no voice is called ${requested.trim()}. The voices are: ${offered.map((v) => v.id).join(", ")}`,
    };
  }
  return { voice: found };
}

/**
 * The voice an agent gets when it has never chosen one.
 *
 * Stable per name rather than one default for everybody: two agents speaking in
 * the same voice in the same room is worse than either of them having a voice
 * nobody picked, and "they all sound identical" is the first thing anybody would
 * report. Choosing explicitly still overrides it.
 */
export function voiceFor(actorId: string, offered: readonly Voice[] = VOICES): Voice {
  let hash = 2_166_136_261;
  for (const character of actorId.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return offered[hash % offered.length]!;
}
