import { describe, expect, it } from "vitest";
import { PENDING_TTL_MS, applyPending, intentOf, settlePending, type PendingMove } from "./board-actions.js";
import { layOutBoard, type BoardCard } from "./board-3d.js";
import { canTransition } from "./board-rules.js";
import type { GestureOutcome, SurfaceHit } from "./surface-input.js";

/**
 * What a gesture on the board means, and what the viewer sees while the server
 * is still thinking about it.
 *
 * The optimistic half is the part worth testing hardest: a guess that outlives
 * the truth is worse than no guess at all, because the card sits in a column it
 * never reached and nothing ever corrects it.
 */

const card = (id: string, status: string, title = id): BoardCard => ({ id, title, status });

const cards = [card("a", "backlog"), card("b", "review"), card("c", "in_progress")];
const layout = layOutBoard(cards);

/** uv for a point in a named column, halfway up. */
const overColumn = (status: string): SurfaceHit => {
  const column = layout.columns.find((c) => c.status === status)!;
  return { panelId: "board", u: column.x / layout.width + 0.5, v: 0.5 };
};

/** A cardOf that just returns a fixed card, for drop tests. */
const always = (c: BoardCard | null) => () => c;

const drop = (from: SurfaceHit, over: SurfaceHit | null): GestureOutcome => ({ kind: "drop", from, over });

describe("what a gesture means", () => {
  it("a tap OPENS the card — the gesture that costs nothing to get wrong", () => {
    const outcome: GestureOutcome = { kind: "tap", hit: { panelId: "board", u: 0.2, v: 0.5 } };
    expect(intentOf(outcome, layout, always(card("a", "backlog")), canTransition))
      .toEqual({ kind: "open", cardId: "a" });
  });

  it("a drop into another column MOVES it", () => {
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, overColumn("assigned"));
    expect(intentOf(outcome, layout, always(card("a", "backlog")), canTransition))
      .toEqual({ kind: "move", cardId: "a", from: "backlog", to: "assigned" });
  });

  it("a drop back in the same column does nothing", () => {
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, overColumn("backlog"));
    expect(intentOf(outcome, layout, always(card("a", "backlog")), canTransition)).toEqual({ kind: "none" });
  });

  it("a drop OFF the panel pulls the card out into its own panel", () => {
    // Nikk: "tasks should even be able to be pulled off the board to have a
    // copied version of that task with much more details in it's own panel".
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, null);
    expect(intentOf(outcome, layout, always(card("b", "review")), canTransition))
      .toEqual({ kind: "pullOff", cardId: "b" });
  });

  it("a drop past the board's edge pulls the card out, and says where", () => {
    // Nikk (4903): dragged "outside of the mood board" it should float there.
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, { panelId: "board", u: 1.3, v: 0.6 });
    expect(intentOf(outcome, layout, always(card("b", "review")), canTransition))
      .toEqual({ kind: "pullOff", cardId: "b", at: { u: 1.3, v: 0.6 } });
  });

  it("REFUSES an illegal move by name, using the server's own rule", () => {
    // Not a second table of legal moves: this asks canTransition, which is what
    // the server will ask. A copy here would drift and then welcome a card the
    // server rejects.
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, overColumn("done"));
    const strict = (from: string, to: string) => !(from === "backlog" && to === "done");
    const intent = intentOf(outcome, layout, always(card("a", "backlog")), strict);
    expect(intent.kind).toBe("refused");
    expect(intent.kind === "refused" && intent.why).toContain("Backlog");
  });

  it("moves a card freely from any column to any other (Nikk 4936)", () => {
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, overColumn("review"));
    expect(intentOf(outcome, layout, always(card("a", "blocked")), canTransition))
      .toEqual({ kind: "move", cardId: "a", from: "blocked", to: "review" });
    expect(canTransition("backlog", "done")).toBe(true);
  });

  it("a cancelled gesture does nothing at all", () => {
    const outcome: GestureOutcome = { kind: "cancelled", from: { panelId: "board", u: 0.1, v: 0.5 } };
    expect(intentOf(outcome, layout, always(card("a", "backlog")), canTransition)).toEqual({ kind: "none" });
  });

  it("a gesture on nothing does nothing", () => {
    const outcome = drop({ panelId: "board", u: 0.1, v: 0.5 }, overColumn("done"));
    expect(intentOf(outcome, layout, always(null), canTransition)).toEqual({ kind: "none" });
  });
});

describe("what the viewer sees while the server is thinking", () => {
  it("moves the card the instant it is dropped", () => {
    // A round trip at 400ms feels broken if the card waits for it.
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    const shown = applyPending(cards, pending);
    expect(shown.find((c) => c.id === "b")?.status).toBe("done");
    // And leaves everything else exactly as the server said.
    expect(shown.find((c) => c.id === "a")?.status).toBe("backlog");
  });

  it("does not mutate the server's list", () => {
    // The guess must never become a second source of truth.
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    applyPending(cards, pending);
    expect(cards.find((c) => c.id === "b")?.status).toBe("review");
  });

  it("drops the guess once the server agrees", () => {
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    const server = [card("a", "backlog"), card("b", "done"), card("c", "in_progress")];
    expect(settlePending(pending, server, 100)).toEqual([]);
  });

  it("KEEPS the guess while the server still disagrees", () => {
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    expect(settlePending(pending, cards, 100)).toHaveLength(1);
  });

  it("gives up on a guess whose reply never came", () => {
    // A card frozen in a column it never reached is a lie that never corrects
    // itself. Better to snap back and let the person try again.
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    expect(settlePending(pending, cards, PENDING_TTL_MS + 1)).toEqual([]);
  });

  it("drops a guess about a card that no longer exists", () => {
    const pending: PendingMove[] = [{ cardId: "gone", to: "done", at: 0 }];
    expect(settlePending(pending, cards, 100)).toEqual([]);
  });

  it("a stale guess cannot outlive a fresh truth", () => {
    // The whole failure mode in one test: server says review, guess says done,
    // guess expires, and the board goes back to telling the truth.
    const pending: PendingMove[] = [{ cardId: "b", to: "done", at: 0 }];
    const settled = settlePending(pending, cards, PENDING_TTL_MS + 1);
    expect(applyPending(cards, settled).find((c) => c.id === "b")?.status).toBe("review");
  });
});
