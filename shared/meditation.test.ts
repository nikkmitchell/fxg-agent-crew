import { describe, expect, it } from "vitest";
import { applyMeditation, breathAt, clockOffset, clockText, cycleSeconds, doneLine, idleMeditation, patternNote, type Meditation } from "./meditation";

const T = 1_000_000;
const started = (over: Partial<Meditation> = {}): Meditation => ({ ...idleMeditation(), startedAt: T, startedBy: "a", together: ["a"], ...over });

describe("where the room is in the breath", () => {
  it("is idle until somebody starts", () => {
    expect(breathAt(idleMeditation(), T)).toEqual({ state: "idle" });
  });

  it("breathes in, then out, on the calm 4 · 6", () => {
    const at = (s: number) => breathAt(started(), T + s * 1000);
    expect(at(0)).toMatchObject({ phase: "in", fullness: 0, secondsLeft: 4 });
    expect(at(2)).toMatchObject({ phase: "in" });
    expect((at(2) as { fullness: number }).fullness).toBeCloseTo(0.5);
    expect(at(4)).toMatchObject({ phase: "out", fullness: 1 });
    expect(at(10)).toMatchObject({ phase: "in", fullness: 0 });
  });

  it("holds full, and rests empty, on the box", () => {
    const at = (s: number) => breathAt(started({ pattern: "box" }), T + s * 1000);
    expect(at(5)).toMatchObject({ phase: "hold", fullness: 1 });
    expect(at(13)).toMatchObject({ phase: "rest", fullness: 0 });
  });

  it("is done once the minutes are up", () => {
    expect(breathAt(started({ minutes: 1 }), T + 60_000)).toEqual({ state: "done", seconds: 60 });
  });

  it("stands still while paused", () => {
    const paused = started({ pausedAt: T + 3000 });
    expect(breathAt(paused, T + 3000)).toEqual(breathAt(paused, T + 90_000));
    expect(breathAt(paused, T + 90_000)).toMatchObject({ paused: true, elapsed: 3 });
  });
});

describe("changing the session", () => {
  it("starts with everybody present counted as together", () => {
    const next = applyMeditation(idleMeditation(), { action: "start", pattern: "box", minutes: 3 }, "a", T, ["b", "a"]);
    expect(next).toMatchObject({ pattern: "box", minutes: 3, startedAt: T, startedBy: "a", together: ["a", "b"], revision: 1 });
  });

  it("refuses a pattern or length it does not know", () => {
    expect(applyMeditation(idleMeditation(), { action: "start", pattern: "nope" }, "a", T)).toHaveProperty("refused");
    expect(applyMeditation(idleMeditation(), { action: "start", minutes: 7 }, "a", T)).toHaveProperty("refused");
  });

  it("resumes exactly where it paused", () => {
    const paused = applyMeditation(started(), { action: "pause" }, "a", T + 3000) as Meditation;
    const resumed = applyMeditation(paused, { action: "resume" }, "b", T + 60_000, ["b"]) as Meditation;
    expect(breathAt(resumed, T + 60_000)).toMatchObject({ elapsed: 3, paused: false });
    expect(resumed.together).toEqual(["a", "b"]);
  });

  it("will not change the pattern under people mid-breath", () => {
    expect(applyMeditation(started(), { action: "settings", pattern: "box" }, "a", T + 1000)).toHaveProperty("refused");
    expect(applyMeditation(idleMeditation(), { action: "settings", pattern: "box" }, "a", T)).toMatchObject({ pattern: "box" });
  });

  it("is put in a room, and hiding it ends the session", () => {
    const shown = applyMeditation(idleMeditation(), { action: "show", shown: true }, "a", T) as Meditation;
    expect(shown.shown).toBe(true);
    const hidden = applyMeditation(started({ shown: true }), { action: "show", shown: false }, "a", T) as Meditation;
    expect(hidden).toMatchObject({ shown: false, startedAt: null });
    expect(applyMeditation(idleMeditation(), { action: "show", shown: "yes" }, "a", T)).toHaveProperty("refused");
  });

  it("ends back to idle", () => {
    expect(breathAt(applyMeditation(started(), { action: "end" }, "a", T) as Meditation, T)).toEqual({ state: "idle" });
  });
});

describe("words", () => {
  it("counts the clock down in minutes and seconds", () => {
    expect(clockText(299.2)).toBe("5:00");
    expect(clockText(61)).toBe("1:01");
  });

  it("says who did it together", () => {
    expect(doneLine(started({ minutes: 1 }))).toBe("1 MINUTE OF BREATHING");
    expect(doneLine(started({ together: ["a", "b", "c"] }))).toBe("5 MINUTES OF BREATHING · together with 3 people");
  });
});

/** Inkstone: the return trip must not be counted as clock skew. */
describe("lining our clock up with the server's", () => {
  it("measures against the middle of the round trip", () => {
    // Clocks agree; the server answered 200 ms into a 400 ms round trip.
    expect(clockOffset(1_200, 1_000, 1_400)).toBe(0);
    // Server 5 s ahead, same trip.
    expect(clockOffset(6_200, 1_000, 1_400)).toBe(5_000);
  });

  it("gives devices on a fast and a slow link the same answer when their clocks agree", () => {
    expect(clockOffset(10_025, 10_000, 10_050)).toBe(clockOffset(10_400, 10_000, 10_800));
  });
});

describe("Wim Hof breathing (meditation-ar-fa021ebb)", () => {
  const session = (): Meditation => ({ ...idleMeditation(), pattern: "wim-hof", minutes: 10, startedAt: 0, shown: true });
  const at = (seconds: number) => breathAt(session(), seconds * 1000);

  it("is thirty quick breaths, a hold on empty lungs, and a recovery breath held full", () => {
    expect(cycleSeconds("wim-hof")).toBeCloseTo(30 * 3 + 60 + 2 + 15 + 3);
    const first = at(0.5);
    expect(first.state === "breathing" && first.words).toBe("BREATH 1 OF 30");
    const last = at(89.5);
    expect(last.state === "breathing" && last.words).toBe("LET GO · 30 OF 30");
    const empty = at(100);
    expect(empty.state === "breathing" && [empty.words, empty.fullness]).toEqual(["ALL OUT · HOLD EMPTY", 0]);
    const full = at(160);
    expect(full.state === "breathing" && [full.words, full.fullness]).toEqual(["HOLD FULL", 1]);
  });

  it("counts down only the long steps, not a breath a second and a half long", () => {
    const quick = at(0.5), hold = at(100);
    expect(quick.state === "breathing" && quick.counted).toBe(false);
    expect(hold.state === "breathing" && hold.counted).toBe(true);
  });

  it("starts the next round where the last one ended", () => {
    const again = at(cycleSeconds("wim-hof") + 0.5);
    expect(again.state === "breathing" && again.words).toBe("BREATH 1 OF 30");
  });

  it("says to sit or lie down before anybody starts it, and only for this one", () => {
    expect(patternNote("wim-hof")).toMatch(/SIT OR LIE DOWN/);
    expect(patternNote("calm")).toBeNull();
  });

  it("is a pattern the server accepts", () => {
    const started = applyMeditation(idleMeditation(), { action: "start", pattern: "wim-hof", minutes: 10 }, "nikk", 0);
    expect("refused" in started).toBe(false);
  });
});
