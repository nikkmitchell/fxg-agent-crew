import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AFTER_SPEAKING_MS, WalkBack } from "../space/walk-back.js";

/** Nikk 7378: an agent that walks over to speak goes back where it was once the line is said. */
describe("walking back after speaking", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes back to where it set off from once the line is said, and not before", () => {
    const back = vi.fn();
    const walk = new WalkBack(back);
    walk.followed("saha.ing", "Mica", { x: 4, z: -2 });
    walk.spoke("saha.ing", "Mica", 3_000);
    vi.advanceTimersByTime(3_000 + AFTER_SPEAKING_MS - 1);
    expect(back).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(back).toHaveBeenCalledWith("saha.ing", "Mica", { x: 4, z: -2 });
  });

  it("waits for the last of several lines, and keeps the first spot through a second follow", () => {
    const back = vi.fn();
    const walk = new WalkBack(back);
    walk.followed("saha.ing", "Skein", { x: 1, z: 1 });
    walk.followed("saha.ing", "Skein", { x: 9, z: 9 });
    walk.spoke("saha.ing", "Skein", 2_000);
    vi.advanceTimersByTime(1_000);
    walk.spoke("saha.ing", "Skein", 4_000);
    vi.advanceTimersByTime(2_000 + AFTER_SPEAKING_MS);
    expect(back).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(back).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledWith("saha.ing", "Skein", { x: 1, z: 1 });
  });

  it("leaves an agent alone that stopped following or set its own route, and one that never walked over", () => {
    const back = vi.fn();
    const walk = new WalkBack(back);
    walk.followed("saha.ing", "Sill", { x: 0, z: 0 });
    walk.spoke("saha.ing", "Sill", 1_000);
    walk.forget("saha.ing", "sill");
    walk.spoke("saha.ing", "Nightjar", 1_000);
    vi.advanceTimersByTime(10_000);
    expect(back).not.toHaveBeenCalled();
  });
});
