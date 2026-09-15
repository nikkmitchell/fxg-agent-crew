import { describe, expect, it } from "vitest";
import { DONE_LIMIT, FRESH_FADE_MS, boardIsLively, foldDone, glowAt, shownStatus } from "./board-freshness";

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

describe("the done column", () => {
  const card = (id: number, fresh?: { changedAt: string; revealAt: string | null }) => ({ id, ...(fresh ? { fresh } : {}) });

  it("shows the ten most recently finished and folds the rest away", () => {
    // Nikk: "let's have done max out at 10 items".
    const newestFirst = Array.from({ length: 14 }, (_, i) => card(i));
    const { shown, folded } = foldDone(newestFirst, 0);
    expect(DONE_LIMIT).toBe(10);
    expect(shown.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(folded.map((c) => c.id)).toEqual([10, 11, 12, 13]);
  });

  it("folds nothing when there are ten or fewer", () => {
    expect(foldDone([card(1), card(2)], 0).folded).toEqual([]);
  });

  it("never folds away a card that is still glowing from just finishing", () => {
    const now = 1_000_000;
    const newestFirst = [...Array.from({ length: 10 }, (_, i) => card(i)), card(99, { changedAt: at(now - 5_000), revealAt: at(now - 4_000) })];
    expect(foldDone(newestFirst, now).shown.map((c) => c.id)).toContain(99);
  });
});
