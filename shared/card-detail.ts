import type { Ink } from "./card-paint.js";
import { CARD_INK, STATUS_STRIPE, fitLines } from "./card-paint.js";

/**
 * A card pulled off the board, with what the card could not hold.
 *
 * Nikk: "tasks should even be able to be pulled off the board to have a copied
 * version of that task with much more details in it's own panel."
 *
 * A COPY, AND IT SAYS SO. The card stays on the board; this is a second view of
 * the same task, not a move. If it were a move, pulling a card off to read it
 * would take it out of the column it belongs in, and somebody else looking at
 * the board would watch work disappear.
 *
 * Same shape as `card-paint`: instructions, not pixels, so it is testable
 * without a canvas and so the room and any test agree about what it says.
 */

export type TaskDetail = {
  id: string;
  title: string;
  status: string;
  description?: string;
  assigneeId?: string;
  points?: number;
  priority?: string;
  blocker?: string;
  owners?: string[];
  comments?: { author: string; body: string; createdAt?: string }[];
  /** The statuses this card may legally move to, from the board's own table. */
  moves?: string[];
};

/** A status as the board writes it, so the panel and the columns agree. */
const columnLabel = (status: string): string =>
  ({ backlog: "Backlog", assigned: "Assigned", in_progress: "Doing", blocked: "Blocked", review: "Review", done: "Done" })[status] ?? status;

export const DETAIL_PX = { width: 768, height: 1024 } as const;

/**
 * How far to drag, as a fraction of the panel's height, to move one comment.
 *
 * It used to stop at six and say the rest were "on the board", which in a
 * headset meant nowhere. Nikk (4903) asked to drag through them all instead.
 */
export const COMMENT_DRAG_STEP = 0.08;

/**
 * Which comment the list starts at after a drag. Like a phone: pulling UP
 * moves on to older comments, pulling down comes back to the newest.
 */
export function commentScroll(start: number, fromV: number, toV: number, count: number): number {
  const moved = Math.round((toV - fromV) / COMMENT_DRAG_STEP);
  return Math.max(0, Math.min(Math.max(0, count - 1), start + moved));
}

/**
 * Where "close" is, as a fraction of the panel.
 *
 * A REGION RATHER THAN A BUTTON MESH, for the same reason the board's cards are
 * hit-tested from geometry: the renderer and the test then ask the same
 * question, and the thing you press is the thing that was drawn.
 *
 * GENEROUS, because this is pressed by a fingertip or a ray from across a room.
 * A close control you have to aim at is one people give up on, and the cost of
 * overshooting is a panel that closes when you meant to read it — annoying, but
 * one press to undo, unlike a card that will not let go.
 */
export const DETAIL_CLOSE = { u0: 0.86, v0: 0.9, u1: 1, v1: 1 } as const;

/**
 * The strip of "move it to…" chips, just above the comment strip.
 *
 * YOU COULD READ A CARD HERE AND NOT ACT ON IT. Pulling a card off the board
 * to see its description and its comments is exactly the moment you decide it
 * is done — and the only way to say so was to close the panel, find the card
 * again among six columns, and drag it. The panel knew the status and the
 * rules and offered neither.
 *
 * ONLY THE LEGAL ONES, from the same table the board uses. A chip that refuses
 * when pressed is a worse answer than a chip that is not there.
 */
export const DETAIL_MOVES = { v0: 0.062, v1: 0.152 } as const;

/** Which move a point falls on, given the moves offered, or null. */
export function detailMoveAt(
  uv: { x: number; y: number },
  moves: readonly string[],
): string | null {
  if (moves.length === 0) return null;
  if (uv.y < DETAIL_MOVES.v0 || uv.y > DETAIL_MOVES.v1) return null;
  if (uv.x < 0 || uv.x > 1) return null;
  const index = Math.min(moves.length - 1, Math.floor(uv.x * moves.length));
  return moves[index] ?? null;
}

/**
 * Where "write a comment" is.
 *
 * ALONG THE BOTTOM, full width, because it is the one thing you are likely to
 * want after reading — and because the bottom of the panel is the one strip
 * whose contents are never predictable enough to put something else in.
 */
export const DETAIL_COMMENT = { u0: 0, v0: 0, u1: 1, v1: 0.062 } as const;

/** True when a point on the panel, in uv, is on the comment control. */
export const isDetailComment = (uv: { x: number; y: number }): boolean =>
  uv.x >= DETAIL_COMMENT.u0 && uv.x <= DETAIL_COMMENT.u1 && uv.y >= DETAIL_COMMENT.v0 && uv.y <= DETAIL_COMMENT.v1;

/** True when a point on the panel, in uv, is on the close control. */
export const isDetailClose = (uv: { x: number; y: number }): boolean =>
  uv.x >= DETAIL_CLOSE.u0 && uv.x <= DETAIL_CLOSE.u1 && uv.y >= DETAIL_CLOSE.v0 && uv.y <= DETAIL_CLOSE.v1;

export function paintDetail(
  task: TaskDetail,
  measure: (text: string, size: number) => number,
  /** How many of the newest comments are scrolled past. */
  commentsFrom = 0,
): Ink[] {
  const { width, height } = DETAIL_PX;
  const pad = 40;
  const inner = width - pad * 2;
  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper, radius: 24 },
    { kind: "line", x: 0, y: 0, width: 16, height, fill: STATUS_STRIPE[task.status] ?? CARD_INK.edge },
  ];

  // THE CLOSE CONTROL, drawn where `DETAIL_CLOSE` says it is. uv has v running
  // UP from the bottom; the canvas has y running DOWN from the top, so the top
  // of the panel is v = 1.
  const closeX = DETAIL_CLOSE.u0 * width;
  const closeH = (DETAIL_CLOSE.v1 - DETAIL_CLOSE.v0) * height;
  ink.push({ kind: "rect", x: closeX, y: 0, width: width - closeX, height: closeH, fill: CARD_INK.paperHeld, radius: 12 });
  ink.push({ kind: "text", x: closeX + 34, y: closeH / 2 + 12, text: "close", size: 26, fill: CARD_INK.muted, weight: "bold" });

  let y = pad + 46;

  // THE TITLE GETS ROOM HERE. On the board it elides at three lines; the whole
  // point of this panel is that it does not have to.
  for (const line of fitLines(measure, task.title, 44, inner - 16, 4)) {
    ink.push({ kind: "text", x: pad, y, text: line, size: 44, fill: CARD_INK.ink, weight: "bold" });
    y += 54;
  }

  y += 10;
  /**
   * THE BOARD'S WORD FOR THE STATUS, not the database's.
   *
   * This printed `in_progress` while the column the card came from says
   * "Doing" — so the panel you pull a card into disagreed with the board you
   * pulled it off. Caught by the test for the move chips, which noticed the
   * raw value was still on the panel.
   */
  const facts: string[] = [columnLabel(task.status)];
  if (task.assigneeId) facts.push(task.assigneeId);
  if (task.points) facts.push(`${task.points} point${task.points === 1 ? "" : "s"}`);
  if (task.priority) facts.push(task.priority);
  ink.push({ kind: "text", x: pad, y, text: facts.join("  ·  "), size: 26, fill: CARD_INK.muted });
  y += 44;

  // A BLOCKER IS NOT A DETAIL. If something is blocked, that sentence is the
  // most useful thing on the panel, so it gets the accent and sits above the
  // description rather than below it.
  if (task.blocker) {
    for (const line of fitLines(measure, `Blocked: ${task.blocker}`, 28, inner - 16, 3)) {
      ink.push({ kind: "text", x: pad, y, text: line, size: 28, fill: CARD_INK.refused });
      y += 36;
    }
    y += 10;
  }

  if (task.description) {
    for (const line of fitLines(measure, task.description, 28, inner - 16, 8)) {
      ink.push({ kind: "text", x: pad, y, text: line, size: 28, fill: CARD_INK.ink });
      y += 36;
    }
    y += 16;
  }

  const comments = task.comments ?? [];
  if (comments.length) {
    ink.push({ kind: "line", x: pad, y, width: inner, height: 2, fill: CARD_INK.edge });
    y += 34;
    ink.push({
      kind: "text",
      x: pad,
      y,
      text: comments.length === 1 ? "1 comment" : `${comments.length} comments`,
      size: 24,
      fill: CARD_INK.muted,
      weight: "bold",
    });
    y += 38;

    // NEWEST FIRST. Pulling a card off a wall to read the oldest remark on it
    // is not what anybody wants.
    //
    // AND AS MANY AS FIT, THEN DRAG FOR THE REST. Nikk (4903): "I'm not able to
    // scroll through all the comments on that task". This stopped at six and
    // sent you to the site for the others; now `commentsFrom` skips that many
    // of the newest, and dragging the panel up moves it on (`CardDetail3D`).
    const newestFirst = comments.slice().reverse();
    const from = Math.max(0, Math.min(commentsFrom, comments.length - 1));
    if (from > 0) {
      ink.push({ kind: "text", x: pad, y, text: `\u25B2 ${from} newer \u2014 drag down`, size: 22, fill: CARD_INK.muted });
      y += 34;
    }
    // Stop above the band of controls at the foot of the panel.
    const floor = height * (1 - DETAIL_MOVES.v1) - 34;
    let drawn = 0;
    for (const comment of newestFirst.slice(from)) {
      const lines = fitLines(measure, comment.body, 24, inner - 16, 3);
      if (y + 30 + lines.length * 30 > floor) break;
      ink.push({ kind: "text", x: pad, y, text: comment.author, size: 22, fill: CARD_INK.accent, weight: "bold" });
      y += 30;
      for (const line of lines) {
        ink.push({ kind: "text", x: pad, y, text: line, size: 24, fill: CARD_INK.ink });
        y += 30;
      }
      y += 12;
      drawn += 1;
    }

    const older = comments.length - from - drawn;
    if (older > 0) {
      ink.push({
        kind: "text",
        x: pad,
        y: Math.min(y, floor + 20),
        text: `\u25BC ${older} older \u2014 drag up`,
        size: 22,
        fill: CARD_INK.muted,
      });
    }
  }

  // THE MOVES, if there are any. Above the comment strip, in the same band of
  // the panel that is reserved for things you DO rather than things you read.
  const moves = task.moves ?? [];
  if (moves.length > 0) {
    const top = (1 - DETAIL_MOVES.v1) * height;
    const band = (DETAIL_MOVES.v1 - DETAIL_MOVES.v0) * height;
    const each = width / moves.length;
    ink.push({ kind: "text", x: pad, y: top - 10, text: "move it to", size: 20, fill: CARD_INK.muted });
    moves.forEach((to, index) => {
      ink.push({
        kind: "rect",
        x: index * each + 4,
        y: top,
        width: each - 8,
        height: band,
        fill: CARD_INK.paperHeld,
        radius: 10,
      });
      const [label] = fitLines(measure, columnLabel(to), 24, each - 24, 1);
      ink.push({
        kind: "text",
        x: index * each + 16,
        y: top + band * 0.62,
        text: label ?? to,
        size: 24,
        fill: CARD_INK.accent,
        weight: "bold",
      });
    });
  }

  // THE COMMENT STRIP, last so nothing drawn above can cover it. Bottom of the
  // panel in uv is the BOTTOM of the bitmap, because v runs up and y runs down.
  const stripHeight = (DETAIL_COMMENT.v1 - DETAIL_COMMENT.v0) * height;
  ink.push({
    kind: "rect",
    x: 0,
    y: height - stripHeight,
    width,
    height: stripHeight,
    fill: CARD_INK.paperHeld,
  });
  ink.push({
    kind: "text",
    x: pad,
    y: height - stripHeight / 2 + 10,
    text: "write a comment",
    size: 26,
    fill: CARD_INK.accent,
    weight: "bold",
  });

  return ink;
}
