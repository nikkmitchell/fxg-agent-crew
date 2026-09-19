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
  /**
   * The language the voice was trained for, as a BCP-47 tag.
   *
   * WAS `"en-US" | "en-GB"`, which was accurate while the catalogue was twelve
   * English voices and became the thing stopping it from describing the other
   * forty-two honestly. A Japanese voice is in the catalogue because the engine
   * has it; saying so is the whole point of the field.
   */
  language: `${string}-${string}`;
};

/**
 * The voices offered, and only ones this project can actually serve.
 *
 * ALL FIFTY-FOUR THE BOX ACTUALLY HAS, and that list was read off the box
 * rather than copied from Kokoro's documentation: the ids below are exactly what
 * `voices-v1.0.bin` contains on saha.ing, 28 MB installed 2026-09-19. Offering a
 * voice the engine cannot produce would be the same lie as a setting that does
 * nothing.
 *
 * THIS WAS TWELVE, and the reason it stopped there was "more than the room has
 * agents". That was the wrong measure and the room proved it: with twelve
 * voices two NAMES collide 62% of the time at five agents, and Sill and Nightjar
 * spent an hour on the identical voice before a person heard it. A catalogue is
 * sized against collisions, not against headcount. Nikk: "if we have a lot
 * installed then we should offer all of them... let's make sure that they're
 * actually available".
 *
 * TWENTY-SIX OF THESE ARE NOT ENGLISH. They are listed with their real language
 * so the chooser can say so — a Japanese voice reading an English line is a
 * thing the engine will happily do and nobody should be surprised by.
 *
 * WHAT ALMOST NOBODY HAS DONE: listened. One voice has been heard by a person
 * and says so. The other fifty-three carry Kokoro's own
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
  { id: "bm_george", blurb: "British, older and deliberate; heard 2026-09-19, Nikk: \"low and smooth\"", language: "en-GB" },
  { id: "bm_lewis", blurb: "British, gravelly", language: "en-GB" },
  { id: "af_alloy", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_aoede", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_jessica", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_kore", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_nova", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_river", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "af_sky", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "am_echo", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "am_eric", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "am_liam", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "am_onyx", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "am_santa", blurb: "American; Kokoro's own naming, not yet heard by anybody here", language: "en-US" },
  { id: "bf_alice", blurb: "British; Kokoro's own naming, not yet heard by anybody here", language: "en-GB" },
  { id: "bf_lily", blurb: "British; Kokoro's own naming, not yet heard by anybody here", language: "en-GB" },
  { id: "bm_daniel", blurb: "British; Kokoro's own naming, not yet heard by anybody here", language: "en-GB" },
  { id: "bm_fable", blurb: "British; Kokoro's own naming, not yet heard by anybody here", language: "en-GB" },
  { id: "ef_dora", blurb: "Spanish; Kokoro's own naming, not yet heard by anybody here", language: "es-ES" },
  { id: "em_alex", blurb: "Spanish; Kokoro's own naming, not yet heard by anybody here", language: "es-ES" },
  { id: "em_santa", blurb: "Spanish; Kokoro's own naming, not yet heard by anybody here", language: "es-ES" },
  { id: "ff_siwis", blurb: "French; Kokoro's own naming, not yet heard by anybody here", language: "fr-FR" },
  { id: "hf_alpha", blurb: "Hindi; Kokoro's own naming, not yet heard by anybody here", language: "hi-IN" },
  { id: "hf_beta", blurb: "Hindi; Kokoro's own naming, not yet heard by anybody here", language: "hi-IN" },
  { id: "hm_omega", blurb: "Hindi; Kokoro's own naming, not yet heard by anybody here", language: "hi-IN" },
  { id: "hm_psi", blurb: "Hindi; Kokoro's own naming, not yet heard by anybody here", language: "hi-IN" },
  { id: "if_sara", blurb: "Italian; Kokoro's own naming, not yet heard by anybody here", language: "it-IT" },
  { id: "im_nicola", blurb: "Italian; Kokoro's own naming, not yet heard by anybody here", language: "it-IT" },
  { id: "jf_alpha", blurb: "Japanese; Kokoro's own naming, not yet heard by anybody here", language: "ja-JP" },
  { id: "jf_gongitsune", blurb: "Japanese; Kokoro's own naming, not yet heard by anybody here", language: "ja-JP" },
  { id: "jf_nezumi", blurb: "Japanese; Kokoro's own naming, not yet heard by anybody here", language: "ja-JP" },
  { id: "jf_tebukuro", blurb: "Japanese; Kokoro's own naming, not yet heard by anybody here", language: "ja-JP" },
  { id: "jm_kumo", blurb: "Japanese; Kokoro's own naming, not yet heard by anybody here", language: "ja-JP" },
  { id: "pf_dora", blurb: "Portuguese; Kokoro's own naming, not yet heard by anybody here", language: "pt-BR" },
  { id: "pm_alex", blurb: "Portuguese; Kokoro's own naming, not yet heard by anybody here", language: "pt-BR" },
  { id: "pm_santa", blurb: "Portuguese; Kokoro's own naming, not yet heard by anybody here", language: "pt-BR" },
  { id: "zf_xiaobei", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zf_xiaoni", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zf_xiaoxiao", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zf_xiaoyi", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zm_yunjian", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zm_yunxi", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zm_yunxia", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
  { id: "zm_yunyang", blurb: "Chinese; Kokoro's own naming, not yet heard by anybody here", language: "zh-CN" },
] as const;

/**
 * THE POOL A NAME IS HASHED INTO — ENGLISH ONLY, AND NOT THE WHOLE CATALOGUE.
 *
 * `voiceFor` picks `offered[hash % offered.length]`, so the pool it is given
 * decides what an agent who has never chosen SOUNDS like. Handing it all 54
 * looked like more variety and was measured before it shipped: Nikk came out as
 * `em_santa` (Spanish) and Sill as `ff_siwis` (French), reading English lines.
 * The engine will do that quite happily and nobody would have asked for it.
 *
 * So a DEFAULT is English, because the room speaks English. A CHOICE is any of
 * the 54, because somebody picking a Japanese voice has decided that on purpose
 * and can hear the result. Offering everything and defaulting to everything are
 * different questions and this file had them as one.
 *
 * Twenty-eight is also the answer to the collision that started all of this:
 * two names clash 62% of the time in twelve voices and about 31% in
 * twenty-eight — better, still not zero, which is why choosing is now possible
 * and a taken voice is refused.
 */
export const DEFAULT_VOICES: readonly Voice[] = VOICES.filter((voice) =>
  voice.language.startsWith("en-"),
);

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
export function voiceFor(actorId: string, offered: readonly Voice[] = DEFAULT_VOICES): Voice {
  let hash = 2_166_136_261;
  for (const character of actorId.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return offered[hash % offered.length]!;
}
