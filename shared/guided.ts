/**
 * Guided meditations: a voice the whole room hears together.
 *
 * Nikk (5455): "put in some guided meditations (using our awesome tts to
 * generate the voice over)". A guide is a breathing session with a script: the
 * orb breathes CALM underneath, and each line below is spoken when the shared
 * session clock reaches its `at`. Every headset reads the same clock (see
 * shared/meditation.ts), so everybody hears the same sentence at the same time
 * without anything being streamed.
 *
 * FIXED TEXT, ON PURPOSE. The server speaks only lines that are written here,
 * never text a caller sends: the same rule as the voice samples, so the audio
 * route cannot be pointed at anything else. Lines are synthesised once, cached
 * on disk, and served for ever.
 *
 * WRITING THEM. Short sentences, a pause after each: a line of about fifteen
 * words takes five or six seconds to say, and the next one starts no sooner
 * than ten seconds later. `at` is seconds from the start of the session.
 */

export type GuideLine = { at: number; say: string };

export type Guide = {
  label: string;
  minutes: 3 | 5 | 10;
  lines: readonly GuideLine[];
};

/** The voice every guide speaks in: Kokoro's clearest, and unhurried. */
export const GUIDE_VOICE = "af_heart";

export const GUIDES = {
  arrive: {
    label: "ARRIVE · 3 MIN",
    minutes: 3,
    lines: [
      { at: 2, say: "Welcome. Let yourself settle where you are, sitting or standing, whatever is comfortable." },
      { at: 14, say: "Let the orb breathe for you. In as it grows, and out, slowly, as it shrinks." },
      { at: 30, say: "Notice the weight of your body. The floor, or the chair, holding you up." },
      { at: 48, say: "There is nothing to fix right now, and nowhere else to be." },
      { at: 66, say: "If your mind wanders, that is fine. Notice where it went, and come back to the breath." },
      { at: 90, say: "Let your shoulders drop a little. Soften your jaw. Unclench your hands." },
      { at: 112, say: "Feel the air coming in, cool, and going out, a little warmer." },
      { at: 136, say: "Just a few more breaths together." },
      { at: 160, say: "Gently notice the room around you again, and when you are ready, carry this calm with you." },
    ],
  },
  kindness: {
    label: "KINDNESS · 5 MIN",
    minutes: 5,
    lines: [
      { at: 2, say: "Welcome. This is a practice of kindness, first for yourself, and then for others." },
      { at: 16, say: "Breathe with the orb for a moment, and let your body settle." },
      { at: 36, say: "Bring to mind yourself, just as you are today." },
      { at: 50, say: "Silently, say to yourself: may I be safe. May I be well. May I be at ease." },
      { at: 74, say: "If the words feel strange, that is all right. Just offer them, the way you would to a friend." },
      { at: 98, say: "Now think of someone who makes you smile. Picture their face." },
      { at: 114, say: "Offer them the same wish. May you be safe. May you be well. May you be at ease." },
      { at: 140, say: "Now think of someone you hardly know. Someone you passed today, perhaps." },
      { at: 156, say: "They want to be happy too, just as you do. May you be safe. May you be well." },
      { at: 184, say: "Now, if you can, bring to mind someone you find difficult. Only as much as feels okay." },
      { at: 202, say: "They have struggles of their own. May you be well. May you be at ease." },
      { at: 230, say: "And now let the wish spread out, to everyone in this room, and everyone beyond it." },
      { at: 250, say: "May all of us be safe. May all of us be well. May all of us be at ease." },
      { at: 278, say: "Rest here for a few breaths. Thank you for practising together." },
    ],
  },
  "body-scan": {
    label: "BODY SCAN · 10 MIN",
    minutes: 10,
    lines: [
      { at: 2, say: "Welcome to a body scan. Find a comfortable position, and let the orb set an easy pace." },
      { at: 20, say: "We will move our attention slowly through the body, just noticing, without changing anything." },
      { at: 44, say: "Begin at the top of your head. Notice any tingling, warmth, or nothing at all." },
      { at: 70, say: "Let your attention move to your forehead, and your eyes. Let them soften." },
      { at: 96, say: "Your cheeks, and your jaw. If there is any tightness, let it loosen as you breathe out." },
      { at: 124, say: "Now your neck and throat. Breathe in, and let the breath make a little space here." },
      { at: 152, say: "Your shoulders. Notice if they are lifted, and let them fall, just a little." },
      { at: 180, say: "Down through your upper arms, your elbows, your forearms." },
      { at: 204, say: "Your wrists, your hands, each finger. Notice the air on your skin." },
      { at: 232, say: "Come back to your chest. Feel it rise as you breathe in, and settle as you breathe out." },
      { at: 262, say: "Your upper back. Your middle back. Your lower back. Let each one be heavy." },
      { at: 292, say: "Your belly. Let it be soft. Nothing to hold in." },
      { at: 320, say: "If your mind has wandered, that is completely normal. Just come back to where we are." },
      { at: 346, say: "Your hips, and the places where your body meets the chair, or the floor." },
      { at: 374, say: "Your thighs. Your knees. Notice any ache, and breathe into it." },
      { at: 402, say: "Your lower legs. Your ankles." },
      { at: 424, say: "Your feet. The soles, the heels, each toe." },
      { at: 452, say: "Now feel your whole body at once, breathing, from the top of your head to your toes." },
      { at: 484, say: "Rest in this for a while. There is nothing to do." },
      { at: 540, say: "In a moment, we will finish. Begin to move your fingers and toes." },
      { at: 568, say: "Notice the room around you. And when you are ready, open your eyes, and carry this with you." },
    ],
  },
  /**
   * WALKING, made for passthrough: the room opens as immersive-ar, so the
   * person can see their own floor and walk slowly around it.
   */
  walking: {
    label: "WALKING · 5 MIN",
    minutes: 5,
    lines: [
      { at: 2, say: "Welcome to a walking meditation. You can see your own room around you, so find a clear path a few steps long." },
      { at: 22, say: "Stand still for a moment. Feel both feet on the floor, and your weight spread between them." },
      { at: 42, say: "Now begin to walk, much more slowly than usual. Half your normal speed, and then half again." },
      { at: 64, say: "Notice the heel lifting. The foot moving through the air. The foot setting down." },
      { at: 88, say: "Lifting. Moving. Placing. Let each step be complete before the next begins." },
      { at: 114, say: "When you reach the end of your path, pause, turn slowly, and walk back." },
      { at: 140, say: "If your mind drifts off, stop for a moment. Feel your feet. Then walk on." },
      { at: 166, say: "Notice the small movements that keep you balanced. Your ankles, your knees, your hips." },
      { at: 192, say: "Let your eyes rest softly ahead of you. There is nowhere to get to." },
      { at: 220, say: "Let your breathing and your steps find their own rhythm together." },
      { at: 250, say: "Begin to slow down even more, and come to a gentle stop." },
      { at: 270, say: "Stand still, and feel the ground under you. Thank you for walking together." },
    ],
  },
  sleep: {
    label: "SLEEP · 10 MIN",
    minutes: 10,
    lines: [
      { at: 2, say: "Welcome. This is a wind-down for the end of the day. Get as comfortable as you can." },
      { at: 22, say: "Let the orb slow your breathing. A little longer on each breath out." },
      { at: 48, say: "The day is finished. Whatever happened today can wait until tomorrow." },
      { at: 74, say: "Let your forehead go smooth. Let your eyes feel heavy." },
      { at: 100, say: "Let your jaw hang loose, and your tongue rest in your mouth." },
      { at: 128, say: "Let your shoulders sink down, as if they were melting." },
      { at: 156, say: "Your arms are heavy. Your hands are heavy and warm." },
      { at: 186, say: "Each breath out lets you sink a little deeper." },
      { at: 216, say: "Your chest and your belly rise and fall on their own. You do not need to do anything." },
      { at: 248, say: "Your legs are heavy. Your feet are heavy and warm." },
      { at: 280, say: "If a thought comes, let it drift past, like a cloud across the sky." },
      { at: 316, say: "Imagine a soft, dim light, slowly fading, as the evening turns into night." },
      { at: 356, say: "Count your breaths backwards from ten. Slowly. If you lose count, simply start again." },
      { at: 420, say: "Heavier. Softer. Quieter." },
      { at: 480, say: "There is nothing left to do today." },
      { at: 540, say: "Rest now. Good night." },
    ],
  },
} as const satisfies Record<string, Guide>;

export type GuideId = keyof typeof GUIDES;
export const GUIDE_IDS = Object.keys(GUIDES) as GuideId[];

export function isGuide(value: unknown): value is GuideId {
  return typeof value === "string" && (GUIDE_IDS as string[]).includes(value);
}

/**
 * The line that should be heard at `elapsed` seconds, if one has just begun.
 *
 * `within` is how late a line may still start: a person who arrives, or whose
 * headset catches up, a few seconds after a line began still hears it; one who
 * arrives a minute later does not get an old sentence out of nowhere.
 */
export function guideLineAt(guide: GuideId, elapsed: number, within = 6): { index: number; line: GuideLine } | null {
  const lines = GUIDES[guide].lines;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.at <= elapsed) return elapsed - line.at <= within ? { index, line } : null;
  }
  return null;
}

/** The line to show as a caption: the most recent one, for as long as the next has not begun. */
export function guideCaption(guide: GuideId, elapsed: number): string | null {
  const lines = GUIDES[guide].lines;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].at <= elapsed) return elapsed - lines[index].at <= 14 ? lines[index].say : null;
  }
  return null;
}

/**
 * READINGS: short public-domain passages, read aloud at the reading stone
 * (src/space/ReadingStone.tsx). Nikk (5463): "creative commons resources like
 * old mandalas or speeches or chants". Everything here is out of copyright:
 * James Legge's 1891 translation of the Tao Te Ching, and poems published
 * before 1900. Voiced once at boot, like the guides, in the same voice.
 */
export type Reading = { title: string; by: string; lines: readonly string[] };

export const READINGS = {
  "tao-8": {
    title: "Like water",
    by: "Tao Te Ching, 8 (tr. James Legge, 1891)",
    lines: [
      "The highest excellence is like that of water.",
      "The excellence of water appears in its benefiting all things,",
      "and in its occupying, without striving to the contrary, the low place which all men dislike.",
      "Hence its way is near to that of the Tao.",
    ],
  },
  "tao-33": {
    title: "Knowing yourself",
    by: "Tao Te Ching, 33 (tr. James Legge, 1891)",
    lines: [
      "He who knows other men is discerning; he who knows himself is intelligent.",
      "He who overcomes others is strong; he who overcomes himself is mighty.",
      "He who is satisfied with his lot is rich; he who goes on acting with energy has a firm will.",
    ],
  },
  hope: {
    title: "Hope is the thing with feathers",
    by: "Emily Dickinson (published 1891)",
    lines: [
      "Hope is the thing with feathers that perches in the soul,",
      "and sings the tune without the words, and never stops at all,",
      "and sweetest in the gale is heard; and sore must be the storm",
      "that could abash the little bird that kept so many warm.",
      "I've heard it in the chillest land, and on the strangest sea;",
      "yet, never, in extremity, it asked a crumb of me.",
    ],
  },
  "summer-grass": {
    title: "A spear of summer grass",
    by: "Walt Whitman, Song of Myself (1855)",
    lines: [
      "I loafe and invite my soul,",
      "I lean and loafe at my ease observing a spear of summer grass.",
    ],
  },
} as const satisfies Record<string, Reading>;

export type ReadingId = keyof typeof READINGS;
export const READING_IDS = Object.keys(READINGS) as ReadingId[];

export function isReading(value: unknown): value is ReadingId {
  return typeof value === "string" && (READING_IDS as string[]).includes(value);
}
