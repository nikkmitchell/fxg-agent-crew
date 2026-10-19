import { describe, expect, it } from "vitest";
import { BOARD_LIMITS } from "../board-rules.js";
import { briefBudget, describeBudget } from "../brief-budget.js";
import { LIMITS } from "../../server/db/store.js";

/**
 * The brief editor knows the server's limit while you type (BOARD_LIMITS, one copy).
 *
 * It used to measure the whole card, comments and all, against the chat's 64,000 as
 * if a card were a chat message — so a card with long comments could not save a
 * brief the server would take.
 */
describe("a card brief's budget", () => {
  it("is the server's own limit, from the one copy both read", () => {
    expect(LIMITS).toBe(BOARD_LIMITS);
    expect(briefBudget("").remaining).toBe(BOARD_LIMITS.description);
  });

  it("counts the brief alone, trimmed, the way the server does", () => {
    expect(briefBudget("  hello  ")).toEqual({ used: 5, remaining: BOARD_LIMITS.description - 5, fits: true });
    // Far past the chat's 64,000 and still a brief the server takes.
    expect(briefBudget("x".repeat(70_000)).fits).toBe(true);
  });

  it("refuses only past the server's limit, and says by how much", () => {
    const over = briefBudget("x".repeat(BOARD_LIMITS.description + 12));
    expect(over.fits).toBe(false);
    expect(describeBudget(over)).toMatchObject({ tone: "over", text: expect.stringContaining("12 characters too long") });
    expect(describeBudget(briefBudget("x".repeat(BOARD_LIMITS.description - 100))).tone).toBe("tight");
    expect(describeBudget(briefBudget("short")).tone).toBe("ok");
  });
});
