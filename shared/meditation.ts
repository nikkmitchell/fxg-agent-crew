/**
 * A breathing session the whole room does together.
 *
 * Nikk (4649): "work on the AR meditation experience ... actually build the
 * full AR meditation experience". The room already opens as `immersive-ar`, so
 * the real room shows through; what it lacked was something to breathe with.
 *
 * ONE CLOCK FOR EVERYBODY. The server keeps only when the session started, the
 * pattern and how long it lasts. Every device works out the phase from those
 * and its own clock, so nobody is streamed a breath and a dropped socket cannot
 * put two people out of step: they are reading the same timetable.
 */

import { GUIDES, isGuide, type GuideId } from "./guided.js";

export type BreathStep = {
  phase: "in" | "hold" | "out" | "rest";
  seconds: number;
  /** What the orb says during this step, when the phase's own word is not enough. */
  words?: string;
};

/**
 * WIM HOF, one round (meditation-ar-fa021ebb, Nikk: "add in Wim Hof ... the way
 * he does the kind of holding your breath"): thirty full, quick breaths in and
 * let go, then everything out and hold on empty lungs, then one deep breath in
 * held full, and let go. The holds are fixed here so the whole room is on one
 * timetable; the method's own holds are as long as each person likes.
 */
const POWER_BREATHS = 30;
function wimHofRound(): BreathStep[] {
  const breaths = Array.from({ length: POWER_BREATHS }, (_, i): BreathStep[] => [
    { phase: "in", seconds: 1.6, words: `BREATH ${i + 1} OF ${POWER_BREATHS}` },
    { phase: "out", seconds: 1.4, words: `LET GO · ${i + 1} OF ${POWER_BREATHS}` },
  ]).flat();
  return [
    ...breaths,
    { phase: "rest", seconds: 60, words: "ALL OUT · HOLD EMPTY" },
    { phase: "in", seconds: 2, words: "DEEP BREATH IN" },
    { phase: "hold", seconds: 15, words: "HOLD FULL" },
    { phase: "out", seconds: 3, words: "LET IT GO" },
  ];
}

export const PATTERNS = {
  calm: { label: "CALM 4 · 6", steps: [{ phase: "in", seconds: 4 }, { phase: "out", seconds: 6 }] },
  box: {
    label: "BOX 4 · 4 · 4 · 4",
    steps: [{ phase: "in", seconds: 4 }, { phase: "hold", seconds: 4 }, { phase: "out", seconds: 4 }, { phase: "rest", seconds: 4 }],
  },
  "4-7-8": {
    label: "4 · 7 · 8",
    steps: [{ phase: "in", seconds: 4 }, { phase: "hold", seconds: 7 }, { phase: "out", seconds: 8 }],
  },
  /**
   * OM, chanted together (Nikk, 5463: "chants"). A short breath in, then a long
   * out-breath spent on one sustained sound. The orb hums the note on every
   * out-breath (breath-sound.ts, omDrone), so the room has a pitch to join.
   */
  om: {
    label: "OM",
    steps: [{ phase: "in", seconds: 4 }, { phase: "out", seconds: 10, words: "CHANT OM" }],
  },
  "wim-hof": {
    label: "WIM HOF",
    // Fast deep breathing and an empty hold can make people light-headed.
    note: "SIT OR LIE DOWN",
    steps: wimHofRound(),
  },
} as const satisfies Record<string, { label: string; note?: string; steps: readonly BreathStep[] }>;

/** A pattern's caution, if it has one: shown before anyone starts it. */
export function patternNote(pattern: PatternId): string | null {
  const one = PATTERNS[pattern];
  return "note" in one ? one.note : null;
}

export type PatternId = keyof typeof PATTERNS;
export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];
export const MINUTES = [1, 3, 5, 10] as const;

export type Meditation = {
  pattern: PatternId;
  minutes: number;
  /** Epoch ms the session began, or null when nobody has started one. */
  startedAt: number | null;
  /** Epoch ms it was paused at; the session is frozen while this is set. */
  pausedAt: number | null;
  /** Who started it, and everybody who was in the room while it ran. */
  startedBy: string | null;
  together: string[];
  /**
   * Whether the orb is in this room at all. A room is not a meditation room
   * because of its name: somebody chooses it in the room's settings, and every
   * room can have one.
   */
  shown: boolean;
  /**
   * A guided meditation spoken over the breath, or null for breathing alone.
   * See shared/guided.ts: a guide fixes the length and breathes CALM.
   */
  guide: GuideId | null;
  /**
   * INTENTION STONES: words people bring to a session ("rest", "patience",
   * a name), each a glowing stone circling the orb.
   *
   * THEY STAY. Nikk (5483): not cleared when a session ends, "so there can be
   * like building up of spaces". Every word adds a stone; past MOST_INTENTIONS
   * the oldest drift away, and a writer can take back their latest.
   */
  intentions: Intention[];
  /**
   * THE STILLNESS TREE's soil: every minute anybody has breathed here with
   * the orb, times how many breathed together. Added when a session ends or
   * the next one starts; it only ever grows (see treeOf).
   */
  breathedMinutes: number;
  revision: number;
};

/** Minutes this session has been breathed, times the people who breathed it. */
export function minutesBreathed(session: Meditation, now: number): number {
  if (session.startedAt === null) return 0;
  const seconds = Math.min(session.minutes * 60, Math.max(0, ((session.pausedAt ?? now) - session.startedAt) / 1000));
  return (seconds / 60) * Math.max(1, session.together.length);
}

/** What the tree looks like after this many minutes breathed together. */
export function treeOf(minutes: number): { branches: number; leaves: number; blossoms: number; height: number } {
  const m = Math.max(0, minutes);
  return {
    // A sapling to begin with; a ring of branches every 30 minutes, up to six.
    branches: Math.min(6, Math.floor(m / 30)),
    // A leaf for every 5 minutes, up to 120.
    leaves: Math.min(120, Math.floor(m / 5)),
    // Blossoms after 10 hours, one more per hour after that, up to 40.
    blossoms: m < 600 ? 0 : Math.min(40, Math.floor((m - 600) / 60) + 1),
    height: 0.35 + Math.min(1.15, m / 400),
  };
}

export type Intention = { by: string; word: string };
export const INTENTION_LONGEST = 24;
export const MOST_INTENTIONS = 40;

/** A word someone typed, as a stone can carry it, or a sentence saying why not. */
export function intentionWord(value: unknown): string | { refused: string } {
  if (typeof value !== "string") return { refused: "an intention is a word or two" };
  const word = value.replace(/\s+/g, " ").trim();
  if (word.length > INTENTION_LONGEST) return { refused: `keep it to ${INTENTION_LONGEST} letters or fewer` };
  return word;
}

export function idleMeditation(): Meditation {
  return { pattern: "calm", minutes: 5, startedAt: null, pausedAt: null, startedBy: null, together: [], shown: false, guide: null, intentions: [], breathedMinutes: 0, revision: 0 };
}

export function isPattern(value: unknown): value is PatternId {
  return typeof value === "string" && (PATTERN_IDS as string[]).includes(value);
}

export function isMinutes(value: unknown): value is number {
  return typeof value === "number" && (MINUTES as readonly number[]).includes(value);
}

export function cycleSeconds(pattern: PatternId): number {
  return (PATTERNS[pattern].steps as readonly BreathStep[]).reduce((sum, step) => sum + step.seconds, 0);
}

export type BreathNow =
  | { state: "idle" }
  | { state: "done"; seconds: number }
  | {
      state: "breathing";
      paused: boolean;
      phase: BreathStep["phase"];
      /** What to show: the step's own words, or the phase's. */
      words: string;
      /** Whether a countdown helps: not for a breath a second and a half long. */
      counted: boolean;
      /** How long this step lasts, so a cue can fit inside it. */
      stepSeconds: number;
      /** 0..1 through this phase. */
      progress: number;
      /** Whole seconds left in this phase, for the count. */
      secondsLeft: number;
      /** 0 (empty) .. 1 (full): how big the orb is. */
      fullness: number;
      elapsed: number;
      remaining: number;
    };

/** Gentle at both ends: breath does not start or stop with a jolt. */
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** Where everybody is in the breath at `now`. Pure, so every device agrees. */
export function breathAt(session: Meditation, now: number): BreathNow {
  if (session.startedAt === null) return { state: "idle" };
  const total = session.minutes * 60;
  const elapsed = Math.max(0, ((session.pausedAt ?? now) - session.startedAt) / 1000);
  if (elapsed >= total) return { state: "done", seconds: total };

  const steps: readonly BreathStep[] = PATTERNS[session.pattern].steps;
  let t = elapsed % cycleSeconds(session.pattern);
  let fullness = 0;
  for (const step of steps) {
    if (t < step.seconds) {
      const progress = t / step.seconds;
      if (step.phase === "in") fullness = ease(progress);
      else if (step.phase === "hold") fullness = 1;
      else if (step.phase === "out") fullness = 1 - ease(progress);
      else fullness = 0;
      return {
        state: "breathing",
        paused: session.pausedAt !== null,
        phase: step.phase,
        words: step.words ?? PHASE_WORDS[step.phase],
        counted: step.seconds >= 3,
        stepSeconds: step.seconds,
        progress,
        secondsLeft: Math.ceil(step.seconds - t),
        fullness,
        elapsed,
        remaining: total - elapsed,
      };
    }
    t -= step.seconds;
  }
  // Unreachable: t is always inside one cycle.
  return { state: "idle" };
}

export const PHASE_WORDS: Record<BreathStep["phase"], string> = {
  in: "BREATHE IN",
  hold: "HOLD",
  out: "BREATHE OUT",
  rest: "REST",
};

export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The closing line: the time, and how many people did it together. */
export function doneLine(session: Meditation): string {
  const others = session.together.length;
  const who = others <= 1 ? "" : ` · together with ${others} people`;
  const what = session.guide ? "GUIDED MEDITATION" : "BREATHING";
  return `${session.minutes} MINUTE${session.minutes === 1 ? "" : "S"} OF ${what}${who}`;
}

export type MeditationChange =
  | { action: "start"; pattern?: unknown; minutes?: unknown; guide?: unknown }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "end" }
  | { action: "show"; shown?: unknown }
  /** Set your own intention; an empty word takes your stone away. */
  | { action: "intend"; word?: unknown }
  | { action: "settings"; pattern?: unknown; minutes?: unknown; guide?: unknown };

/**
 * One change, applied. Returns the new session or a sentence saying why not.
 * `present` is who is in the room right now; they are added to `together`.
 */
export function applyMeditation(
  session: Meditation,
  change: MeditationChange,
  by: string,
  now: number,
  present: string[] = [],
): Meditation | { refused: string } {
  const next = { ...session, revision: session.revision + 1 };
  const pick = (c: { pattern?: unknown; minutes?: unknown; guide?: unknown }) => {
    if (c.pattern !== undefined && !isPattern(c.pattern)) return "unknown breathing pattern";
    if (c.minutes !== undefined && !isMinutes(c.minutes)) return `minutes must be one of ${MINUTES.join(", ")}`;
    if (c.guide !== undefined && c.guide !== null && !isGuide(c.guide)) return "unknown guided meditation";
    if (c.guide !== undefined) next.guide = (c.guide as GuideId | null) ?? null;
    // Choosing a breathing pattern or a length yourself means breathing without a guide.
    if (c.guide === undefined && (c.pattern !== undefined || c.minutes !== undefined)) next.guide = null;
    if (c.pattern !== undefined) next.pattern = c.pattern as PatternId;
    if (c.minutes !== undefined) next.minutes = c.minutes as number;
    // A guide's script is timed to its own length, over CALM breathing.
    if (next.guide) {
      next.minutes = GUIDES[next.guide].minutes;
      next.pattern = "calm";
    }
    return null;
  };
  const running = breathAt(session, now).state === "breathing";

  switch (change.action) {
    case "start": {
      const refused = pick(change);
      if (refused) return { refused };
      return { ...next, breathedMinutes: session.breathedMinutes + minutesBreathed(session, now), startedAt: now, pausedAt: null, startedBy: by, together: unique([by, ...present]) };
    }
    case "settings": {
      if (running) return { refused: "end the session before changing it" };
      const refused = pick(change);
      return refused ? { refused } : next;
    }
    case "pause":
      if (!running || session.pausedAt !== null) return { refused: "nothing is breathing to pause" };
      return { ...next, pausedAt: now };
    case "resume":
      if (session.pausedAt === null || session.startedAt === null) return { refused: "the session is not paused" };
      // Shift the start by however long it sat paused, so the breath carries on
      // from exactly where it stopped.
      return { ...next, startedAt: session.startedAt + (now - session.pausedAt), pausedAt: null, together: unique([...session.together, ...present]) };
    case "show":
      if (typeof change.shown !== "boolean") return { refused: "shown must be true or false" };
      // Hiding it ends any session: an orb nobody can see is not breathing with anybody.
      return change.shown ? { ...next, shown: true } : {
        ...idleMeditation(), pattern: session.pattern, minutes: session.minutes, revision: next.revision,
        // What the room has built up stays, even with the orb put away.
        intentions: session.intentions,
        breathedMinutes: session.breathedMinutes + minutesBreathed(session, now),
      };
    case "end":
      return { ...next, breathedMinutes: session.breathedMinutes + minutesBreathed(session, now), startedAt: null, pausedAt: null, startedBy: null, together: [] };
    case "intend": {
      const word = intentionWord(change.word);
      if (typeof word !== "string") return word;
      if (word) return { ...next, intentions: [...session.intentions, { by, word }].slice(-MOST_INTENTIONS) };
      // An empty word takes back your own latest stone, and nobody else's.
      const latest = session.intentions.map((one) => one.by.toLowerCase()).lastIndexOf(by.toLowerCase());
      if (latest < 0) return { refused: "you have no stone here to take back" };
      return { ...next, intentions: session.intentions.filter((_, index) => index !== latest) };
    }
    default:
      return { refused: "unknown action" };
  }
}

function unique(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))];
}

/** A stored session read back, or null when it is not one. Missing fields take their defaults. */
export function parseMeditation(value: unknown): Meditation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Meditation>;
  const base = idleMeditation();
  const time = (t: unknown) => (typeof t === "number" && Number.isFinite(t) ? t : null);
  return {
    pattern: isPattern(v.pattern) ? v.pattern : base.pattern,
    minutes: isMinutes(v.minutes) ? v.minutes : base.minutes,
    startedAt: time(v.startedAt),
    pausedAt: time(v.pausedAt),
    startedBy: typeof v.startedBy === "string" ? v.startedBy : null,
    together: Array.isArray(v.together) ? v.together.filter((n): n is string => typeof n === "string") : [],
    shown: v.shown === true,
    guide: isGuide(v.guide) ? v.guide : null,
    breathedMinutes: typeof v.breathedMinutes === "number" && Number.isFinite(v.breathedMinutes) && v.breathedMinutes > 0 ? v.breathedMinutes : 0,
    intentions: Array.isArray(v.intentions)
      ? v.intentions.filter((one): one is Intention =>
          !!one && typeof one === "object" && typeof (one as Intention).by === "string" && typeof (one as Intention).word === "string")
        .slice(0, MOST_INTENTIONS)
      : [],
    revision: Number.isInteger(v.revision) ? (v.revision as number) : 0,
  };
}

/**
 * How far the server's clock is ahead of ours, from one request.
 *
 * Inkstone's review: taking `serverNow - arrivedAt` counts the whole return
 * trip as skew, so two devices on different links read the same session some
 * hundreds of milliseconds apart and their tones land out of step. The server
 * stamped `now` somewhere between sending and arriving; the midpoint is the
 * best single guess (the estimate NTP makes), and its error is at most half the
 * round trip rather than all of it.
 */
export function clockOffset(serverNow: number, sentAt: number, arrivedAt: number): number {
  return serverNow - (sentAt + arrivedAt) / 2;
}

/**
 * THE BREATH ON THE FLOOR. On every out-breath a ring rolls out across the
 * floor from beneath the orb and fades, like a ripple on still water: in
 * passthrough it lands on the person's own floor, so the breath is something
 * you can see leave you. Pure, from the shared breath, so everybody's ripple
 * is the same ripple.
 *
 * Returns the ring's radius in metres and how visible it is, or null when no
 * ripple is on the floor.
 */
export const RIPPLE_REACH = 2.6;
export function rippleAt(breath: BreathNow): { radius: number; opacity: number } | null {
  if (breath.state !== "breathing" || breath.phase !== "out") return null;
  const t = breath.progress;
  // Eases out: quick to leave the orb, slowing as it spreads, like water.
  const radius = 0.25 + (RIPPLE_REACH - 0.25) * (1 - (1 - t) * (1 - t));
  const opacity = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  return opacity > 0.01 ? { radius, opacity } : null;
}
