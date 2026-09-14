import { describe, expect, it } from "vitest";
import { FRESH_FADE_MS, LONG_FINISHED_MS, boardIsLively, glowAt, longFinished, shownStatus } from "./board-freshness";

const at = (ms: number) => new Date(ms).toISOString();

describe("a card that just changed", () => {
  // Nikk: "a bright color, and slowly fade to normal color over 1 minute".
  it("glows fully when revealed and fades to nothing over a minute", () => {
    const fresh = { changedAt: at(0), revealAt: at(10_000) };
    expect(glowAt(10_000, fresh)).toBe(1);
    expect(glowAt(10_000 + FRESH_FADE_MS / 2, fresh)).toBeCloseTo(0.5, 9);
    expect(glowAt(10_000 + FRESH_FADE_MS, fresh)).toBe(0);
    expect(glowAt(10_000 + FRESH_FADE_MS * 3, fresh)).toBe(0);
  });

  it("does not glow while its agent is still walking to the board", () => {
    expect(glowAt(5_000, { changedAt: at(0), revealAt: null })).toBe(0);
  });

  it("stays in its old column until the agent reaches the board, then moves", () => {
    // "make sure that the task board changes happen when they reach the board".
    const moving = { status: "done", fresh: { changedAt: at(0), revealAt: null, previousStatus: "review" } };
    expect(shownStatus(moving)).toBe("review");
    expect(shownStatus({ ...moving, fresh: { ...moving.fresh, revealAt: at(8_000) } })).toBe("done");
  });

  it("does not appear at all until then, if it is a new card", () => {
    expect(shownStatus({ status: "backlog", fresh: { changedAt: at(0), revealAt: null } })).toBeNull();
    expect(shownStatus({ status: "backlog" }), "an unchanged card is simply where it is").toBe("backlog");
  });

  it("keeps the board refreshing quickly while anything is pending or glowing", () => {
    expect(boardIsLively([{ fresh: { changedAt: at(0), revealAt: null } }], 1_000)).toBe(true);
    expect(boardIsLively([{ fresh: { changedAt: at(0), revealAt: at(0) } }], 30_000)).toBe(true);
    expect(boardIsLively([{ fresh: { changedAt: at(0), revealAt: at(0) } }], 90_000)).toBe(false);
    expect(boardIsLively([{}], 0)).toBe(false);
  });
});

describe("cards finished long ago", () => {
  it("are done cards not touched for days, and nothing else", () => {
    const now = LONG_FINISHED_MS * 2;
    expect(longFinished({ status: "done", updatedAt: at(0) }, now)).toBe(true);
    expect(longFinished({ status: "done", updatedAt: at(now - 1000) }, now)).toBe(false);
    expect(longFinished({ status: "review", updatedAt: at(0) }, now)).toBe(false);
  });
});
