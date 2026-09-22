import { columnAt, moveRefusal, type BoardCard, type BoardLayout } from "./board-3d.js";
import type { Status } from "./board-rules.js";
import type { GestureOutcome, SurfaceHit } from "./surface-input.js";

/**
 * What a gesture on the board MEANS.
 *
 * Between "the hand let go here" and "PATCH /tasks/x/status" there is a
 * decision, and it is the decision that has the bugs: which column did it land
 * in, is that move allowed, does the card go back, does letting go in mid-air
 * mean anything. Putting it in the component would make it untestable and
 * would also mean writing it again for the mood board.
 *
 * OPTIMISTIC, WITH THE SERVER AS THE AUTHORITY. The card moves the instant it
 * is dropped, because waiting for a round trip at 400ms feels broken — and the
 * feed reconciles. A refusal puts it back and says why. This room has been
 * bitten before by a client that believed itself, so the optimistic state is
 * explicitly a GUESS that the next feed overwrites, never a second source of
 * truth.
 */

export type BoardIntent =
  /** Move a card to another column. The server is asked; the view already moved. */
  | { kind: "move"; cardId: string; from: string; to: Status }
  /** Open this card's own panel, a copy with more in it than the card shows. */
  | { kind: "open"; cardId: string }
  /** The card was released off every panel: pull it out into its own panel. */
  | { kind: "pullOff"; cardId: string }
  /** Nothing happened worth telling anybody about. */
  | { kind: "none" }
  /** The move was refused before it was sent. Say so; put the card back. */
  | { kind: "refused"; cardId: string; why: string };

/**
 * Decide what a finished gesture did.
 *
 * `canTransition` is passed in rather than imported so this asks the SAME rule
 * the server will apply. A second opinion here would drift and then the board
 * would accept a card the server rejects.
 */
export function intentOf(
  outcome: GestureOutcome,
  layout: BoardLayout,
  cardOf: (hit: SurfaceHit) => BoardCard | null,
  canTransition: (from: Status, to: Status) => boolean,
): BoardIntent {
  if (outcome.kind === "cancelled") return { kind: "none" };

  const card = cardOf(outcome.kind === "tap" ? outcome.hit : outcome.from);
  if (!card) return { kind: "none" };

  // A TAP OPENS. It is the one gesture that costs nothing to get wrong, so it
  // gets the destructive-free meaning.
  if (outcome.kind === "tap") return { kind: "open", cardId: card.id };

  // Released off every panel: out into the room as its own panel.
  if (!outcome.over) return { kind: "pullOff", cardId: card.id };

  const column = columnAt(layout, { x: outcome.over.u, y: outcome.over.v });
  if (!column) return { kind: "pullOff", cardId: card.id };
  if (column.status === card.status) return { kind: "none" };

  const why = moveRefusal(card.status, column.status, canTransition);
  if (why) return { kind: "refused", cardId: card.id, why };
  return { kind: "move", cardId: card.id, from: card.status, to: column.status };
}

/**
 * The board as the viewer sees it right now: the server's cards, with any
 * un-acknowledged move applied on top.
 *
 * SEPARATE FROM THE SERVER'S LIST, never merged into it. When the feed brings
 * a fresh list, the guess is dropped for any card the server has now placed —
 * so a stale guess cannot outlive the truth, which is the failure mode that
 * makes optimistic UI worse than none.
 */
export type PendingMove = { cardId: string; to: Status; at: number };

export function applyPending(
  cards: readonly BoardCard[],
  pending: readonly PendingMove[],
): BoardCard[] {
  if (!pending.length) return [...cards];
  const byCard = new Map(pending.map((move) => [move.cardId, move]));
  return cards.map((card) => {
    const move = byCard.get(card.id);
    return move ? { ...card, status: move.to } : card;
  });
}

/**
 * Drop guesses the server has caught up with, and guesses that are simply old.
 *
 * TIMED OUT RATHER THAN KEPT, because a move whose reply never came is a move
 * that probably did not happen, and a card frozen in a column it never reached
 * is a lie that never corrects itself. Seconds, not minutes: long enough for a
 * slow link, short enough that a person still remembers doing it.
 */
export const PENDING_TTL_MS = 8_000;

export function settlePending(
  pending: readonly PendingMove[],
  serverCards: readonly BoardCard[],
  now: number,
): PendingMove[] {
  const status = new Map(serverCards.map((card) => [card.id, card.status]));
  return pending.filter((move) => {
    if (now - move.at > PENDING_TTL_MS) return false;
    const actual = status.get(move.cardId);
    // The server agrees, or the card is gone: either way stop guessing.
    if (actual === undefined) return false;
    return actual !== move.to;
  });
}
