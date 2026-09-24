import { describe, expect, it } from "vitest";
import { cueFor } from "./breath-sound";

describe("which tone the orb plays", () => {
  const breathing = (phase: "in" | "hold" | "out" | "rest", paused = false) => ({ state: "breathing", phase, paused });

  it("rings the bell at the start and at the end", () => {
    expect(cueFor({ state: "idle" }, breathing("in"))).toBe("bell");
    expect(cueFor(breathing("out"), { state: "done" })).toBe("bell");
  });

  it("marks each new phase, and nothing in between", () => {
    expect(cueFor(breathing("in"), breathing("out"))).toBe("out");
    expect(cueFor(breathing("in"), breathing("in"))).toBeNull();
  });

  it("stays quiet on the first frame, and while paused", () => {
    expect(cueFor(null, breathing("in")), "arriving mid-session is not a start").toBeNull();
    expect(cueFor(breathing("in"), breathing("out", true))).toBeNull();
  });
});
