import { describe, expect, it } from "vitest";
import { CLOCK_PRESETS, clockLabel, clockNow, clockText, presetOf, settleTurn, startClock } from "./go-clock";

const T = 1_000_000;

describe("the Go clock", () => {
  it("is off by default and starts with every bank full", () => {
    expect(startClock(0, 2, T)).toBeNull();
    const clock = startClock(2, 3, T)!;
    expect(clock).toEqual({ perMove: 30, bank: [300, 300, 300], turnStartedAt: T });
    expect(presetOf(clock)).toBe(2);
    expect(clockLabel(clock)).toBe("30s + 5m");
    expect(clockLabel(null)).toBe("OFF");
  });

  it("uses the free seconds first, then the bank", () => {
    const clock = startClock(1, 2, T)!; // 10 s a move, 60 s bank
    expect(clockNow(clock, 0, T + 4_000)).toMatchObject({ moveLeft: 6, bankLeft: 60, flagged: false });
    expect(clockNow(clock, 0, T + 25_000)).toMatchObject({ moveLeft: 0, bankLeft: 45, flagged: false });
  });

  it("charges only what a move used past its free seconds, and starts the next turn", () => {
    const clock = startClock(1, 2, T)!;
    const after = settleTurn(clock, 0, T + 25_000);
    expect(after.bank).toEqual([45, 60]);
    expect(after.turnStartedAt).toBe(T + 25_000);
    expect(settleTurn(clock, 0, T + 5_000).bank).toEqual([60, 60]);
  });

  it("flags a player who runs over with nothing left", () => {
    const clock = { ...startClock(1, 2, T)!, bank: [5, 60] };
    expect(clockNow(clock, 0, T + 14_000).flagged).toBe(false);
    expect(clockNow(clock, 0, T + 16_000).flagged).toBe(true);
  });

  it("offers off and four speeds", () => {
    expect(CLOCK_PRESETS[0]).toBeNull();
    expect(CLOCK_PRESETS.length).toBe(5);
    expect(clockText(65)).toBe("1:05");
  });
});
