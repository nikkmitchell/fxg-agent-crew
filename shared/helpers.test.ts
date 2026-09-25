import { describe, expect, it } from "vitest";
import { DONE_LINGER_MS, HELPERS_TTL_MS, MAX_HELPERS, helperSummary, liveHelpers, parseHelpers } from "./helpers";

describe("what an agent may report", () => {
  it("takes labels and states, and an empty list clears", () => {
    expect(parseHelpers({ helpers: [{ label: " scout ", state: "working" }] })).toEqual({ helpers: [{ label: "scout", state: "working" }] });
    expect(parseHelpers({ helpers: [] })).toEqual({ helpers: [] });
    expect(parseHelpers({ helpers: [{ label: "a" }] })).toEqual({ helpers: [{ label: "a", state: "working" }] });
  });

  it("refuses what it cannot draw honestly", () => {
    expect(parseHelpers({})).toHaveProperty("refused");
    expect(parseHelpers({ helpers: [{ state: "working" }] })).toHaveProperty("refused");
    expect(parseHelpers({ helpers: [{ label: "a", state: "asleep" }] })).toHaveProperty("refused");
    expect(parseHelpers({ helpers: Array.from({ length: MAX_HELPERS + 1 }, (_, i) => ({ label: `h${i}` })) })).toHaveProperty("refused");
  });
});

describe("what the room draws", () => {
  const at = 1_000_000;
  it("draws working helpers, and finished ones only briefly", () => {
    const reports = { Sill: { at, helpers: [{ label: "a", state: "working" as const }, { label: "b", state: "done" as const }] } };
    expect(liveHelpers(reports, at + 1000).Sill).toHaveLength(2);
    expect(liveHelpers(reports, at + DONE_LINGER_MS + 1).Sill).toEqual([{ label: "a", state: "working" }]);
  });

  it("forgets a report the agent stopped refreshing, so a crashed parent does not keep spirits", () => {
    const reports = { Sill: { at, helpers: [{ label: "a", state: "working" as const }] } };
    expect(liveHelpers(reports, at + HELPERS_TTL_MS + 1)).toEqual({});
  });

  it("says how many and who", () => {
    expect(helperSummary([{ label: "scout", state: "working" }, { label: "tests", state: "working" }])).toBe("2 helpers working: scout, tests");
    expect(helperSummary([{ label: "x", state: "done" }])).toBe("helpers finished");
  });
});
