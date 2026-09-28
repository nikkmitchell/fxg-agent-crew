import { describe, expect, it } from "vitest";
import { STILL_SECONDS, follow, silenceHeld } from "./SilenceBell";

describe("the silence bell", () => {
  it("keeps a head's stillness through small drift, and restarts it on a real move", () => {
    const a = follow(undefined, { x: 0, y: 1.6, z: 0 }, 0);
    expect(follow(a, { x: 0.02, y: 1.61, z: 0 }, 10).since).toBe(0);
    expect(follow(a, { x: 0.3, y: 1.6, z: 0 }, 10).since).toBe(10);
  });
  it("rings only when at least two are all still long enough", () => {
    const still = { anchor: { x: 0, y: 0, z: 0 }, since: 0 };
    expect(silenceHeld([still], STILL_SECONDS)).toBe(false);
    expect(silenceHeld([still, still], STILL_SECONDS)).toBe(true);
    expect(silenceHeld([still, { ...still, since: 20 }], STILL_SECONDS)).toBe(false);
  });
});
