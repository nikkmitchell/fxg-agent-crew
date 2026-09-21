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
};

export const DETAIL_PX = { width: 768, height: 1024 } as const;

/**
 * How many comments are drawn before it stops.
 *
 * A panel that scrolls is a panel that needs a scrollbar, a drag that competes
 * with moving the panel, and a second thing to test. The most recent few are
 * what a person wants when they pull a card off a wall; the rest are on the
 * site. The count says how many were not shown, so it is not pretending.
 */
export const COMMENTS_SHOWN = 6;

export function paintDetail(
  task: TaskDetail,
  measure: (text: string, size: number) => number,
): Ink[] {
  const { width, height } = DETAIL_PX;
  const pad = 40;
  const inner = width - pad * 2;
  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper, radius: 24 },
    { kind: "line", x: 0, y: 0, width: 16, height, fill: STATUS_STRIPE[task.status] ?? CARD_INK.edge },
  ];

  let y = pad + 46;

  // THE TITLE GETS ROOM HERE. On the board it elides at three lines; the whole
  // point of this panel is that it does not have to.
  for (const line of fitLines(measure, task.title, 44, inner - 16, 4)) {
    ink.push({ kind: "text", x: pad, y, text: line, size: 44, fill: CARD_INK.ink, weight: "bold" });
    y += 54;
  }

  y += 10;
  const facts: string[] = [task.status];
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
    for (const comment of comments.slice(-COMMENTS_SHOWN).reverse()) {
      if (y > height - pad - 40) break;
      ink.push({ kind: "text", x: pad, y, text: comment.author, size: 22, fill: CARD_INK.accent, weight: "bold" });
      y += 30;
      for (const line of fitLines(measure, comment.body, 24, inner - 16, 3)) {
        if (y > height - pad - 10) break;
        ink.push({ kind: "text", x: pad, y, text: line, size: 24, fill: CARD_INK.ink });
        y += 30;
      }
      y += 12;
    }

    if (comments.length > COMMENTS_SHOWN) {
      ink.push({
        kind: "text",
        x: pad,
        y: Math.min(y, height - pad),
        text: `${comments.length - COMMENTS_SHOWN} older, on the board`,
        size: 22,
        fill: CARD_INK.muted,
      });
    }
  }

  return ink;
}
