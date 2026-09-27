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
