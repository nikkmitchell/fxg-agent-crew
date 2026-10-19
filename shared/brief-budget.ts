import { BOARD_LIMITS } from "./board-rules.js";

/**
 * How much of a card's brief is left, while it is being written.
 *
 * The board is saha.ing's own database (ADR-002): a brief is its own column,
 * bounded at BOARD_LIMITS.description by the server, whatever else the card holds.
 * This used to measure the whole card as if it were a chat message, because
 * before the cutover a board change WAS one; afterwards a card with long comments
 * could not save a brief the server would have taken (2026-10-20).
 *
 * Counted the way the server counts: the trimmed text's length.
 */
export type Budget = { used: number; remaining: number; fits: boolean };

export function briefBudget(description: string): Budget {
  const used = description.trim().length;
  return { used, remaining: BOARD_LIMITS.description - used, fits: used <= BOARD_LIMITS.description };
}

/** One sentence for a person, chosen by how much trouble they are in. */
export function describeBudget(budget: Budget): { tone: "ok" | "tight" | "over"; text: string } {
  const n = (value: number) => value.toLocaleString("en-US");
  if (!budget.fits) return { tone: "over", text: `${n(-budget.remaining)} characters too long to save; a brief can be ${n(BOARD_LIMITS.description)}.` };
  if (budget.remaining <= 2_000) return { tone: "tight", text: `${n(budget.remaining)} characters left.` };
  return { tone: "ok", text: `${n(budget.remaining)} characters left of ${n(BOARD_LIMITS.description)}.` };
}
