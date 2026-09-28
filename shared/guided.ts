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
  /** A Kokoro voice for this guide; GUIDE_VOICE when not given. zf_ voices speak Mandarin. */
  voice?: string;
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
  /**
   * ARRIVE, in Mandarin, for the people in China who use this room (Nikk and
   * baiwei are in Shanghai). Spoken by a Mandarin Kokoro voice; /opt/kokoro/say
   * picks the language from the voice's first letter.
   */
  "arrive-zh": {
    label: "到达 · 3 分钟",
    minutes: 3,
    voice: "zf_xiaoxiao",
    lines: [
      { at: 2, say: "欢迎。无论坐着还是站着，找一个舒服的姿势，让自己安顿下来。" },
      { at: 16, say: "跟着光球呼吸。它变大时吸气，它变小时，慢慢呼气。" },
      { at: 32, say: "感受身体的重量。地板或者椅子，正稳稳地支撑着你。" },
      { at: 50, say: "此刻没有什么需要解决，也没有别的地方要去。" },
      { at: 68, say: "如果思绪飘走了，没关系。留意它去了哪里，然后回到呼吸。" },
      { at: 92, say: "让肩膀放松一点。放松下巴。松开双手。" },
      { at: 114, say: "感受空气进来时的清凉，和出去时的温暖。" },
      { at: 138, say: "我们再一起呼吸几次。" },
      { at: 160, say: "慢慢地，重新注意到周围的房间。准备好了，就带着这份平静继续前行。" },
    ],
  },
  "kindness-zh": {
    label: "慈心 · 5 分钟",
    minutes: 5,
    voice: "zf_xiaoxiao",
    lines: [
      { at: 2, say: "欢迎。这是一个关于善意的练习，先给自己，再给别人。" },
      { at: 16, say: "跟着光球呼吸一会儿，让身体慢慢安定下来。" },
      { at: 36, say: "想一想现在的自己，就是今天这样的你。" },
      { at: 50, say: "在心里对自己说：愿我平安。愿我健康。愿我自在。" },
      { at: 74, say: "如果这些话感觉有点陌生，没关系。就像对朋友说话那样，送给自己。" },
      { at: 98, say: "现在想一个让你微笑的人。看见他的脸。" },
      { at: 114, say: "把同样的祝福送给他。愿你平安。愿你健康。愿你自在。" },
      { at: 140, say: "现在想一个你几乎不认识的人。也许是今天擦肩而过的人。" },
      { at: 156, say: "他也和你一样，想要快乐。愿你平安。愿你健康。" },
      { at: 184, say: "如果可以，想一个让你觉得不容易相处的人。只到你觉得可以的程度。" },
      { at: 202, say: "他也有自己的难处。愿你健康。愿你自在。" },
      { at: 230, say: "现在让这份祝福扩散开来，给这个房间里的每一个人，也给房间外的所有人。" },
      { at: 250, say: "愿我们都平安。愿我们都健康。愿我们都自在。" },
      { at: 278, say: "在这里再停留几次呼吸。谢谢你和大家一起练习。" },
    ],
  },
  counting: {
    label: "COUNTING · 3 MIN",
    minutes: 3,
    lines: [
      { at: 2, say: "Welcome. This is the simplest practice there is: counting breaths." },
      { at: 14, say: "Breathe in with the orb. As you breathe out, silently count one." },
      { at: 30, say: "Next breath out, two. Then three. Up to ten." },
      { at: 48, say: "When you reach ten, begin again at one." },
      { at: 70, say: "If you lose count, or find yourself at fifteen, that is fine. Just start again at one." },
      { at: 96, say: "Losing count is not failing. Noticing you lost it is the practice." },
      { at: 124, say: "Keep counting, softly. One number for each breath out." },
      { at: 150, say: "Let the numbers go now, and just breathe." },
      { at: 166, say: "Thank you for counting together." },
    ],
  },
  mountain: {
    label: "MOUNTAIN · 5 MIN",
    minutes: 5,
    lines: [
      { at: 2, say: "Welcome. Sit or stand tall, with your feet planted, and let the orb set your breath." },
      { at: 20, say: "Picture a mountain. Its base wide and rooted in the earth, its peak high in the sky." },
      { at: 42, say: "Let your body become that mountain. Solid at the base. Upright. Still." },
      { at: 66, say: "Around a mountain, the weather changes. Sun, then cloud. Wind, then rain." },
      { at: 90, say: "The mountain does not chase the sunshine, or run from the storm. It stays." },
      { at: 116, say: "Your thoughts and feelings are weather too. Let them pass over you." },
      { at: 142, say: "Something pleasant. Something difficult. Both pass. The mountain remains." },
      { at: 170, say: "Feel how steady you can be, just by staying with your breath." },
      { at: 200, say: "Seasons come and go. Snow melts. Flowers grow. The mountain sits through all of it." },
      { at: 232, say: "Rest here, as the mountain, for a few more breaths." },
      { at: 270, say: "Slowly let the image go, and carry some of its steadiness with you." },
    ],
  },
} as const satisfies Record<string, Guide>;

/** The voice a guide is spoken in. */
export function guideVoice(id: keyof typeof GUIDES): string {
  const guide: Guide = GUIDES[id];
  return guide.voice ?? GUIDE_VOICE;
}

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
export type Reading = { title: string; by: string; lines: readonly string[]; voice?: string };

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
  /** The same two chapters in the original, read by the Mandarin voice. */
  "tao-8-zh": {
    title: "上善若水",
    by: "道德经 · 第八章（老子，约公元前 400 年）",
    voice: "zf_xiaoxiao",
    lines: [
      "上善若水。",
      "水善利万物而不争，处众人之所恶，故几于道。",
      "居善地，心善渊，与善仁，言善信，政善治，事善能，动善时。",
      "夫唯不争，故无尤。",
    ],
  },
  "tao-33-zh": {
    title: "自知者明",
    by: "道德经 · 第三十三章（老子，约公元前 400 年）",
    voice: "zf_xiaoxiao",
    lines: [
      "知人者智，自知者明。",
      "胜人者有力，自胜者强。",
      "知足者富。强行者有志。",
      "不失其所者久。死而不亡者寿。",
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
  retreat: {
    title: "A retreat into yourself",
    by: "Marcus Aurelius, Meditations 4.3 (tr. George Long, 1862)",
    lines: [
      "Men seek retreats for themselves, houses in the country, sea-shores, and mountains;",
      "and thou too art wont to desire such things very much.",
      "But this is altogether a mark of the most common sort of men,",
      "for it is in thy power whenever thou shalt choose to retire into thyself.",
    ],
  },
  woods: {
    title: "To live deliberately",
    by: "Henry David Thoreau, Walden (1854)",
    lines: [
      "I went to the woods because I wished to live deliberately,",
      "to front only the essential facts of life,",
      "and see if I could not learn what it had to teach,",
      "and not, when I came to die, discover that I had not lived.",
    ],
  },
  /** Spoken once to a first-time visitor, and on request, at the guide sign (src/space/RoomGuideSign.tsx). */
  welcome: {
    title: "Welcome",
    by: "Sill, for meditation.AR (2026)",
    lines: [
      "Welcome to the meditation room. There is no right way to be here.",
      "The glowing orb in front of you breathes. Breathe with it, or start a guided meditation under it.",
      "The sign on your left lists everything in the room, and which way to go.",
      "Take your time. Wander. Sit. Nothing here needs to be finished.",
    ],
  },
  /** The welcome, for a browser whose language is Chinese. */
  "welcome-zh": {
    title: "欢迎",
    by: "Sill, for meditation.AR (2026)",
    voice: "zf_xiaoxiao",
    lines: [
      "欢迎来到冥想室。在这里，没有对或错的方式。",
      "你面前发光的光球在呼吸。跟着它呼吸，或者在它下面开始一段引导冥想。",
      "左边的牌子上列出了房间里的一切，以及往哪里走。",
      "慢慢来。四处走走，坐一坐。这里没有什么需要完成。",
    ],
  },
  /** Read at the tea table (src/space/TeaTable.tsx), not on the stone's list. */
  tea: {
    title: "A cup of tea",
    by: "Sill, for meditation.AR (2026)",
    lines: [
      "Hold the cup in both hands. Feel its warmth.",
      "Look at the steam rising, and disappearing.",
      "Breathe in the smell of the tea, slowly.",
      "Take one small sip. Notice the taste, the warmth, the swallow.",
      "This cup of tea is the only thing to do right now.",
      "Drink the rest slowly, one sip at a time.",
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

/** The voice a reading is spoken in. */
export function readingVoice(id: ReadingId): string {
  const reading: Reading = READINGS[id];
  return reading.voice ?? GUIDE_VOICE;
}
