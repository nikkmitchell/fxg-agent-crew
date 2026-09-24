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

export type BreathStep = { phase: "in" | "hold" | "out" | "rest"; seconds: number };

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
} as const satisfies Record<string, { label: string; steps: readonly BreathStep[] }>;

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
  revision: number;
};

export function idleMeditation(): Meditation {
  return { pattern: "calm", minutes: 5, startedAt: null, pausedAt: null, startedBy: null, together: [], shown: false, revision: 0 };
}

export function isPattern(value: unknown): value is PatternId {
  return typeof value === "string" && (PATTERN_IDS as string[]).includes(value);
}

export function isMinutes(value: unknown): value is number {
  return typeof value === "number" && (MINUTES as readonly number[]).includes(value);
}

export function cycleSeconds(pattern: PatternId): number {
  return PATTERNS[pattern].steps.reduce((sum, step) => sum + step.seconds, 0);
}

export type BreathNow =
  | { state: "idle" }
  | { state: "done"; seconds: number }
  | {
      state: "breathing";
      paused: boolean;
      phase: BreathStep["phase"];
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

  const steps = PATTERNS[session.pattern].steps;
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
  return `${session.minutes} MINUTE${session.minutes === 1 ? "" : "S"} OF BREATHING${who}`;
}

export type MeditationChange =
  | { action: "start"; pattern?: unknown; minutes?: unknown }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "end" }
  | { action: "show"; shown?: unknown }
  | { action: "settings"; pattern?: unknown; minutes?: unknown };

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
  const pick = (c: { pattern?: unknown; minutes?: unknown }) => {
    if (c.pattern !== undefined && !isPattern(c.pattern)) return "unknown breathing pattern";
    if (c.minutes !== undefined && !isMinutes(c.minutes)) return `minutes must be one of ${MINUTES.join(", ")}`;
    if (c.pattern !== undefined) next.pattern = c.pattern as PatternId;
    if (c.minutes !== undefined) next.minutes = c.minutes as number;
    return null;
  };
  const running = breathAt(session, now).state === "breathing";

  switch (change.action) {
    case "start": {
      const refused = pick(change);
      if (refused) return { refused };
      return { ...next, startedAt: now, pausedAt: null, startedBy: by, together: unique([by, ...present]) };
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
      return change.shown ? { ...next, shown: true } : { ...idleMeditation(), pattern: session.pattern, minutes: session.minutes, revision: next.revision };
    case "end":
      return { ...next, startedAt: null, pausedAt: null, startedBy: null, together: [] };
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
    revision: Number.isInteger(v.revision) ? (v.revision as number) : 0,
  };
}
