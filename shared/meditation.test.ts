import { describe, expect, it } from "vitest";
import { applyMeditation, breathAt, clockText, doneLine, idleMeditation, type Meditation } from "./meditation";

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
