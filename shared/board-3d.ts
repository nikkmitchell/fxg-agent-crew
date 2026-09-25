import { STATUSES, type Status } from "./board-rules.js";

/**
 * Where every card sits on the work board, in the room.
 *
 * PURE, AND THAT IS THE POINT. This is the one piece both halves of the board
 * need — the renderer to know where to put a card, and the pointer to know
 * which card it is over — and it is the piece that has to agree with itself or
 * a card lands somewhere it cannot be picked up again. So it is arithmetic over
 * plain data, with no three.js, no canvas and no DOM in it, and it can be
 * tested without a renderer. This suite has none.
 *
 * COORDINATES ARE PANEL-LOCAL METRES, origin at the CENTRE of the board, x to
 * the right and y UP. That is three.js's convention for a plane, so a caller
 * can position a card with the numbers it gets back rather than converting.
 * UV from a raycast is converted here too, in one place: `cardAt` takes the uv
 * three.js hands you and does the flip, because y-down versus y-up is exactly
 * the sort of thing that is wrong in one of two places for a week.
 */

export type BoardCard = {
  id: string;
  title: string;
  status: string;
  /** Who is carrying it, if anyone. Shown on the card. */
  assigneeId?: string;
  /** For the corner count. The detail panel shows the bodies. */
  commentCount?: number;
  points?: number;
};

/** A card's place on the board, in panel-local metres. */
export type CardPlace = {
  card: BoardCard;
  /** Centre of the card. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which column it is in, left to right. */
  column: number;
  /** Where it sits in that column, top first. */
  row: number;
};

export type BoardColumn = {
  status: Status;
  label: string;
  /** Centre x of the column, panel-local metres. */
  x: number;
  width: number;
  count: number;
};

export type BoardLayout = {
  width: number;
  height: number;
  columns: BoardColumn[];
  cards: CardPlace[];
  /** Columns that hold more than fits; the surplus is not drawn. */
  overflow: { status: Status; hidden: number }[];
  /** Compact up/down controls in the column heading for a column with overflow. */
  scrollers: BoardScroller[];
};

export type BoardScroller = {
  status: Status;
  direction: "up" | "down";
  /** How many cards are that way. */
  count: number;
  /** The column's scroll offset a press moves to. */
  to: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * WHICH COLUMNS THE ROOM SHOWS.
 *
 * All six statuses, in the order the rules define them, because a board that
 * hides a column cannot be used to move a card into it — and moving a card
 * between columns is the whole feature. `blocked` earns its place for the same
 * reason: it is where a card goes when it cannot go forward, and a person in a
 * headset needs somewhere to put it.
 */
export const BOARD_COLUMNS: readonly { status: Status; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "Doing" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

/**
 * How tall a card is, as a fraction of its width.
 *
 * It is the shape of the bitmap `card-paint` draws into, and it lives here
 * because the LAYOUT is what has to honour it: a plane whose aspect disagrees
 * with its texture stretches the text on it.
 */
export const CARD_SHAPE = 256 / 512;

/**
 * The proportions a board can be laid out at.
 *
 * A TYPE, because `BOARD` below is `as const` and its literal `2.4` would
 * otherwise become the only width the layout accepts — which quietly made the
 * size parameter decorative and the board a fixed rectangle on a panel that is
 * not.
 */
export type BoardSize = {
  width: number;
  height: number;
  /** Room above the column headings for the board's own name. */
  titleHeight: number;
  headerHeight: number;
  columnGap: number;
  cardHeight: number;
  cardGap: number;
  padding: number;
};

/** The board's default proportions, in metres. Tuned for arm's reach in a headset. */
export const BOARD = {
  width: 2.4,
  height: 1.5,
  /**
   * A BAND FOR THE BOARD'S OWN NAME, reserved rather than borrowed.
   *
   * The name went in first without one, squeezed into the couple of
   * centimetres between the panel's edge and the column headings — where it
   * overlapped them. A caption with nowhere to go is worse than no caption:
   * it makes the headings harder to read as well as itself.
   */
  titleHeight: 0.1,
  /** Room above the columns for the heading. */
  headerHeight: 0.14,
  columnGap: 0.012,
  cardHeight: 0.16,
  cardGap: 0.01,
  /** Inset from the panel edge so cards do not touch the frame. */
  padding: 0.03,
} as const;

const columnLabel = (status: Status): string =>
  BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;

/**
 * Lay the board out.
 *
 * Cards keep the order they are given. The caller sorts — `board-order.ts`
 * already decides what "first" means, and a second opinion here would fight it.
 */
export function layOutBoard(
  cards: readonly BoardCard[],
  size: BoardSize = BOARD,
  /**
   * How far each column is scrolled: how many of its cards are above the first
   * one drawn. Baiwei (saha-ing-7e74aa11): "the task board currently shows
   * only five tasks and offers no way to reach the remaining review items".
   */
  scroll: Partial<Record<Status, number>> = {},
): BoardLayout {
  const columnCount = BOARD_COLUMNS.length;
  const usableWidth = size.width - size.padding * 2;
  const columnWidth = (usableWidth - size.columnGap * (columnCount - 1)) / columnCount;
  /**
   * A CARD IS AS TALL AS ITS OWN PICTURE, not a fixed number of centimetres.
   *
   * `card-paint` draws into a 512x256 bitmap — two to one — and the card was
   * drawn on a plane of columnWidth by a flat 0.16m, which on a four-metre
   * board is four to one. A texture on a plane of a different aspect is
   * STRETCHED, so every card on the board had its text squashed to half its
   * proper height. That is the third time this exact mistake has turned up in
   * this room, and the first two were in panels I wrote after this one.
   *
   * Deriving the height from the width makes it impossible rather than
   * unlikely. It also means FEWER, READABLE cards per column instead of a
   * dozen cramped strips — and the ones that do not fit are reported, which is
   * what `overflow` has always been for.
   */
  const cardHeight = columnWidth * CARD_SHAPE;
  const top = size.height / 2 - size.padding - size.titleHeight - size.headerHeight;
  const bottom = -size.height / 2 + size.padding;
  /**
   * ONE FEWER THAN FITS, because the foot of every column belongs to its "add a
   * card" strip — see `addControlOf`. Without this reservation a full column
   * would stack a card underneath the strip, and pressing that card would make
   * a new one instead of picking it up.
   */
  const addRoom = cardHeight + size.cardGap;
  const perColumn = Math.max(0, Math.floor((top - bottom - addRoom + size.cardGap) / (cardHeight + size.cardGap)));

  const columns: BoardColumn[] = [];
  const places: CardPlace[] = [];
  const overflow: { status: Status; hidden: number }[] = [];
  const scrollers: BoardScroller[] = [];

  BOARD_COLUMNS.forEach((column, index) => {
    const x = -usableWidth / 2 + columnWidth / 2 + index * (columnWidth + size.columnGap);
    const mine = cards.filter((card) => card.status === column.status);
    columns.push({ status: column.status, label: column.label, x, width: columnWidth, count: mine.length });

    const slotY = (row: number) => top - cardHeight / 2 - row * (cardHeight + size.cardGap);
    const place = (card: BoardCard, row: number) =>
      places.push({ card, x, y: slotY(row), width: columnWidth, height: cardHeight, column: index, row });

    if (mine.length <= perColumn) {
      mine.forEach(place);
      return;
    }

    /**
     * MORE THAN FITS: IT SCROLLS. Compact controls live in the header, not in
     * the card stack, so overflowing columns keep every available card slot.
     */
    const pageSize = Math.max(1, perColumn);
    const want = Math.max(0, Math.floor(scroll[column.status] ?? 0));
    // The furthest offset that still fills the last page.
    const last = Math.max(0, mine.length - pageSize);
    const offset = Math.min(want, last);
    const up = offset > 0;
    const shown = Math.min(pageSize, mine.length - offset);
    const down = offset + shown < mine.length;
    // Share the heading band with the existing status/count label. The pair
    // stays small and out of the task slots, even for dense columns.
    const scrollWidth = Math.min(columnWidth * 0.28, 0.11);
    const scrollHeight = Math.min(size.headerHeight * 0.38, 0.052);
    const scrollX = x + columnWidth / 2 - Math.min(columnWidth * 0.03, 0.01) - scrollWidth / 2;
    const headerY = top + size.headerHeight / 2;
    const scrollOffsetY = (scrollHeight + 0.008) / 2;
    mine.slice(offset, offset + shown).forEach((card, i) => place(card, i));
    if (up) {
      scrollers.push({ status: column.status, direction: "up", count: offset, to: Math.max(0, offset - pageSize),
        x: scrollX, y: headerY + scrollOffsetY, width: scrollWidth, height: scrollHeight });
    }
    if (down) {
      const below = mine.length - (offset + shown);
      scrollers.push({ status: column.status, direction: "down", count: below, to: Math.min(last, offset + pageSize),
        x: scrollX, y: headerY - scrollOffsetY, width: scrollWidth, height: scrollHeight });
    }

    // SAID, NOT SWALLOWED. A column that silently stops drawing at the tenth
    // card is a board that lies about how much work there is.
    overflow.push({ status: column.status, hidden: mine.length - shown });
  });

  return { width: size.width, height: size.height, columns, cards: places, overflow, scrollers };
}

/** The compact scroll control under a point, or null. Exact, like a card. */
export function scrollerAt(layout: BoardLayout, uv: { x: number; y: number }): BoardScroller | null {
  const point = pointFromUv(layout, uv);
  return (
    layout.scrollers.find(
      (s) => Math.abs(point.x - s.x) <= s.width / 2 && Math.abs(point.y - s.y) <= s.height / 2,
    ) ?? null
  );
}

/**
 * The card under a point, or null.
 *
 * TAKES THREE.JS UV, so callers do not each invent the conversion. three gives
 * u from 0 at the left to 1 at the right, and v from 0 at the BOTTOM to 1 at
 * the top; this returns panel-local metres with y up, which is what everything
 * else here speaks.
 */
export function cardAt(layout: BoardLayout, uv: { x: number; y: number }): CardPlace | null {
  const point = pointFromUv(layout, uv);
  return (
    layout.cards.find(
      (place) =>
        Math.abs(point.x - place.x) <= place.width / 2 && Math.abs(point.y - place.y) <= place.height / 2,
    ) ?? null
  );
}

/** Panel-local metres from a three.js uv. */
export function pointFromUv(layout: BoardLayout, uv: { x: number; y: number }): { x: number; y: number } {
  return { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
}

/**
 * The plate behind a column, in panel-local metres.
 *
 * SIX COLUMNS OF FLAT CREAM DO NOT READ AS COLUMNS. The board drew one
 * background and let the cards float on it, so which column a card was in was
 * something you worked out from its left edge lining up with a heading a metre
 * above. A faint plate per column gives the eye the lane, which matters most in
 * exactly the case the board is for: judging at a glance where the work is
 * piled up.
 *
 * It also gives an EMPTY column a shape. Before, a column with nothing in it
 * was indistinguishable from the gap between two columns.
 */
export function columnPlateOf(
  layout: BoardLayout,
  column: BoardColumn,
  size: BoardSize = BOARD,
): { x: number; y: number; width: number; height: number } {
  const top = layout.height / 2 - size.padding - size.titleHeight - size.headerHeight;
  const bottom = -layout.height / 2 + size.padding;
  return {
    x: column.x,
    y: (top + bottom) / 2,
    width: column.width,
    height: Math.max(0, top - bottom),
  };
}

/**
 * Where a column's "add a card" control sits, in panel-local metres.
 *
 * ONE IN EACH COLUMN, not one button somewhere on the panel. A single "new
 * task" would have to ask which column afterwards, which is a second step and a
 * second thing to get wrong; pressing the column you want says it in one go.
 *
 * NOT IN `backlog` ONLY, either. Work does not always start in the backlog —
 * somebody writing down what they are doing right now wants it in `in_progress`
 * and should not have to move it twice to get there.
 *
 * A FULL-WIDTH STRIP AT THE FOOT OF THE COLUMN, and it is the second design.
 * The first was a small square in the header, about three per cent of the
 * board's width — roughly seven pixels on screen at a normal panel size, and
 * proportionally no better for a controller ray from four metres away. I could
 * not hit it with coordinates I had CALCULATED, which is the clearest possible
 * evidence that nobody was going to hit it by eye. The strip is the width of a
 * card and as tall as one, so it is exactly as easy to press as the things
 * beside it, and it sits where a new card would go anyway.
 *
 * THE LAYOUT RESERVES ITS ROOM — see `layOutBoard`, which fits one fewer card
 * per column — so it can never end up underneath the card at the bottom of a
 * full column. Overlapping controls are how a press on a card creates a card.
 */
export function addControlOf(
  layout: BoardLayout,
  column: BoardColumn,
  size: BoardSize = BOARD,
): { x: number; y: number; width: number; height: number } {
  // A card's height, derived the same way, so the strip stays in step with the
  // cards above it however wide the panel is.
  const height = column.width * CARD_SHAPE;
  return {
    x: column.x,
    y: -layout.height / 2 + size.padding + height / 2,
    width: column.width,
    height,
  };
}

/**
 * The column whose add control is under a point, or null.
 *
 * EXACT, unlike `columnAt`. Dropping a card is forgiving because a card has to
 * land somewhere; pressing "add" is not, because the nearest add control to a
 * miss is a new card in the wrong column — silent, and more annoying to undo
 * than to redo.
 */
export function addAt(layout: BoardLayout, uv: { x: number; y: number }, size: BoardSize = BOARD): BoardColumn | null {
  const point = pointFromUv(layout, uv);
  for (const column of layout.columns) {
    const box = addControlOf(layout, column, size);
    if (
      Math.abs(point.x - box.x) <= box.width / 2 &&
      Math.abs(point.y - box.y) <= box.height / 2
    ) {
      return column;
    }
  }
  return null;
}

/**
 * Panel-local metres back to uv — the inverse of `pointFromUv`.
 *
 * WHY THIS HAD TO EXIST. The room read `event.uv` straight off the R3F pointer
 * event, which is right for the board's own background mesh and WRONG for every
 * card on it: uv is per-mesh, so a press on a card gave the uv of THAT CARD's
 * little plane — 0..1 across the card itself — which was then read as a
 * position on the whole board. Pressing the right-hand edge of a card in
 * `review` reported a point near the middle of the board, so `cardAt` found
 * nothing and every drag silently did nothing at all.
 *
 * Nothing in the pure tests could catch it: they are handed a uv and are
 * correct about what is there. The renderer was handing them the wrong one.
 *
 * So the room converts the intersection POINT — which is the same world point
 * whichever mesh reports it — into the board's own frame, and asks here. One
 * question, one answer, regardless of what the ray happened to hit first.
 */
export function uvFromPanelPoint(layout: BoardLayout, point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x / layout.width + 0.5, y: point.y / layout.height + 0.5 };
}

/**
 * The column a point falls in, for a drop.
 *
 * NEAREST COLUMN BY CENTRE, not strict containment. A card dropped in the gap
 * between two columns has to go somewhere, and refusing it because the pointer
 * was four millimetres into a gutter is the kind of precision a headset cannot
 * deliver and a person should not have to.
 */
export function columnAt(layout: BoardLayout, uv: { x: number; y: number }): BoardColumn | null {
  if (!layout.columns.length) return null;
  const point = pointFromUv(layout, uv);
  // Outside the panel entirely is a real "nowhere" — that is a drop into the
  // room, which is how a card gets pulled off the board.
  if (Math.abs(point.x) > layout.width / 2 || Math.abs(point.y) > layout.height / 2) return null;
  return layout.columns.reduce((best, column) =>
    Math.abs(point.x - column.x) < Math.abs(point.x - best.x) ? column : best,
  );
}

/**
 * Whether a move is one the board will accept, asked BEFORE the drag lands.
 *
 * The server decides, and `canTransition` in board-rules is that decision. This
 * asks the same function so a card can be shown as unwelcome while it is still
 * in the air, rather than snapping back after a refusal. Same rule, one source
 * — a second table of legal moves here would drift and then lie to the person
 * dragging.
 */
export function moveRefusal(
  from: string,
  to: Status,
  canTransition: (from: Status, to: Status) => boolean,
): string | null {
  if (from === to) return null;
  if (!(STATUSES as readonly string[]).includes(from)) return `"${from}" is not a status this board knows`;
  return canTransition(from as Status, to) ? null : `a card cannot go from ${columnLabel(from as Status)} to ${columnLabel(to)}`;
}
