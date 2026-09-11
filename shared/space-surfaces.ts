/**
 * What is hanging on the walls.
 *
 * A projection, not a second store. Everything here comes from `tasks` and
 * `board_items`; the room reads and never writes. If this file disappeared, the
 * board would be untouched.
 *
 * Deliberately NARROWER than `/bff/board/projects/:id`. That view carries every
 * comment and every link on every card, which is right for the board page and
 * wrong for a wall of tiles read from four metres away: a room left open would
 * refetch hundreds of kilobytes to redraw a hundred rectangles.
 */

/** The six lanes, in the order they appear across the wall. */
export const LANES = ["backlog", "assigned", "in_progress", "blocked", "review", "done"] as const;
export type Lane = (typeof LANES)[number];

export const LANE_LABELS: Record<Lane, string> = {
  backlog: "Backlog",
  assigned: "Assigned",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export type WallCard = {
  id: string;
  title: string;
  status: Lane;
  /** Null means nobody said. Not "build" — see the schema. */
  kind: "build" | "decision" | null;
  owners: string[];
  /** The stated reason a card is blocked, when there is one. */
  blocker: string | null;
};

export type WallItem = {
  id: string;
  kind: "image" | "link" | "note" | "swatch";
  /** Present for an uploaded image; fetched from /bff/board/blobs/:id. */
  blobId: string | null;
  text: string | null;
  caption: string | null;
  /** The 2D board's own coordinates, in its own units. Fitted to the wall. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type WallBoard = { id: string; name: string; items: WallItem[] };

export type Surfaces = {
  /**
   * Every project, so the wall can be pointed at a different one. `updatedAt`
   * is when anything in the project last changed — the latest card, not the
   * project row, which barely ever moves.
   */
  projects: { id: string; name: string; updatedAt: string }[];
  /** Which one these surfaces are for. Null when there are no projects at all. */
  projectId: string | null;
  cards: WallCard[];
  boards: WallBoard[];
};
