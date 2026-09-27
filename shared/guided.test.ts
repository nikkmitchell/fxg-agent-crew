import { describe, expect, it } from "vitest";
import { GUIDES, GUIDE_IDS, guideCaption, guideLineAt } from "./guided.js";
import { applyMeditation, idleMeditation, parseMeditation, type Meditation } from "./meditation.js";

describe("the guided scripts (Nikk, 5455)", () => {
  it("fit inside their own length, in order, with room to say each line", () => {
    for (const id of GUIDE_IDS) {
      const { lines, minutes } = GUIDES[id];
      lines.forEach((line, index) => {
        expect(line.at, `${id} line ${index} starts inside the session`).toBeLessThan(minutes * 60 - 8);
        if (index > 0) expect(line.at - lines[index - 1].at, `${id} line ${index} leaves the last one time to be said`).toBeGreaterThanOrEqual(10);
        expect(line.say.length, `${id} line ${index} is short enough to say in a breath or two`).toBeLessThanOrEqual(120);
      });
    }
  });

  it("gives each line once, when it begins, and not an old one to somebody arriving late", () => {
    const first = GUIDES.arrive.lines[0];
    expect(guideLineAt("arrive", first.at + 1)?.index).toBe(0);
    // Between two lines, ten seconds after the last began: too late to start it.
    expect(guideLineAt("arrive", GUIDES.arrive.lines[1].at + 10)).toBeNull();
    expect(guideLineAt("arrive", 0)).toBeNull();
  });

  it("captions the latest line until it has had time to be read", () => {
    expect(guideCaption("arrive", GUIDES.arrive.lines[1].at + 3)).toBe(GUIDES.arrive.lines[1].say);
    expect(guideCaption("arrive", 179)).toBeNull();
  });
});

describe("a guided session", () => {
  const start = (session: Meditation, guide: unknown) => applyMeditation(session, { action: "start", guide }, "Nikk2", 1_000);

  it("takes its length from the script and breathes CALM underneath", () => {
    const after = start({ ...idleMeditation(), pattern: "box", minutes: 1 }, "body-scan") as Meditation;
    expect(after.guide).toBe("body-scan");
    expect(after.minutes).toBe(10);
    expect(after.pattern).toBe("calm");
    expect(after.startedAt).toBe(1_000);
  });

  it("refuses a guide nobody wrote", () => {
    expect(start(idleMeditation(), "shout")).toEqual({ refused: "unknown guided meditation" });
  });

  it("goes back to plain breathing when somebody picks a pattern or a length", () => {
    const guided = { ...idleMeditation(), guide: "arrive" as const, minutes: 3 };
    const after = applyMeditation(guided, { action: "settings", pattern: "box" }, "Nikk2", 1_000) as Meditation;
    expect(after.guide).toBeNull();
    expect(after.pattern).toBe("box");
  });

  it("survives being stored, and an old stored session has no guide", () => {
    expect(parseMeditation({ ...idleMeditation(), guide: "kindness" })?.guide).toBe("kindness");
    expect(parseMeditation({ pattern: "calm" })?.guide).toBeNull();
  });
});

describe("OM, chanted together", () => {
  it("is a short breath in and a long chanted breath out", async () => {
    const { PATTERNS, cycleSeconds } = await import("./meditation.js");
    expect(PATTERNS.om.steps.map((step) => step.phase)).toEqual(["in", "out"]);
    expect(cycleSeconds("om")).toBe(14);
  });
});

describe("the breath on the floor", () => {
  it("rolls out on the out-breath only, spreading and fading", async () => {
    const { rippleAt, breathAt, idleMeditation, RIPPLE_REACH } = await import("./meditation.js");
    const session = { ...idleMeditation(), startedAt: 0, minutes: 5 };
    // CALM is 4 s in, 6 s out.
    expect(rippleAt(breathAt(session, 2_000))).toBeNull();
    const early = rippleAt(breathAt(session, 4_600))!;
    const later = rippleAt(breathAt(session, 7_000))!;
    expect(later.radius).toBeGreaterThan(early.radius);
    expect(later.radius).toBeLessThanOrEqual(RIPPLE_REACH);
    expect(rippleAt(breathAt(session, 9_999))?.opacity ?? 0).toBeLessThan(0.1);
    expect(rippleAt({ state: "idle" })).toBeNull();
  });
});
