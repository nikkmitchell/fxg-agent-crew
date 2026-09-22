/**
 * The mood board, as geometry.
 *
 * WHAT IT IS. Unlike the work board, a mood board has no columns: it is a
 * free-form canvas of pictures and notes, each with a position and a size in
 * CSS PIXELS on a plane that has no edges. The website scrolls it. A panel in a
 * room cannot scroll — there is no scrollbar worth having on a wall, and a drag
 * to scroll would fight the drag that moves the panel — so the whole board is
 * FITTED to the panel instead, and what people arranged stays arranged.
 *
 * FIT, NOT CROP. Cropping would hide whatever somebody put at the edge, and the
 * edge is exactly where people put the thing they added last.
 *
 * PURE, for the same reason as the board: which item is under a finger has to
 * be the question the renderer answered when it drew that item.
 */

export type MoodItem = {
  id: string;
  kind: string;
  /** Pixels, from the top-left of the board's own plane. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text?: string;
  /** Where to fetch the picture, for the kinds that have one. */
  src?: string;
  addedBy?: string;
};

export type MoodSize = { width: number; height: number; padding: number };

export const MOOD: MoodSize = { width: 4.0, height: 2.5, padding: 0.06 };

export type MoodPlace = {
  item: MoodItem;
  /** Panel-local metres, centre of the item. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MoodLayout = {
  width: number;
  height: number;
  /** Back to front, so a renderer can draw in order and a hit-test can walk back. */
  places: MoodPlace[];
  /** Metres per pixel, for turning a drag back into the board's own units. */
  scale: number;
  /** The pixel rectangle that was fitted, so a drag can be converted back. */
  bounds: { x: number; y: number; width: number; height: number };
};

/** A sensible rectangle when the board is empty, so the maths never divides by zero. */
const EMPTY_BOUNDS = { x: 0, y: 0, width: 1200, height: 750 };

export function moodBounds(items: readonly MoodItem[]): MoodLayout["bounds"] {
  if (items.length === 0) return { ...EMPTY_BOUNDS };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.w);
    bottom = Math.max(bottom, item.y + item.h);
  }
  // A MINIMUM SIZE. One small note on its own would otherwise be fitted to the
  // whole panel and fill a wall, which looks like a bug rather than a note.
  const width = Math.max(right - left, EMPTY_BOUNDS.width / 2);
  const height = Math.max(bottom - top, EMPTY_BOUNDS.height / 2);
  return { x: left, y: top, width, height };
}

export function layOutMood(items: readonly MoodItem[], size: MoodSize = MOOD): MoodLayout {
  const bounds = moodBounds(items);
  const usableWidth = size.width - size.padding * 2;
  const usableHeight = size.height - size.padding * 2;
  // ONE SCALE FOR BOTH AXES. Fitting each axis separately would stretch every
  // picture on the board to a different shape than the person who put it there
  // chose, which is the one thing a mood board must not do.
  const scale = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);

  const places = [...items]
    .sort((a, b) => a.z - b.z)
    .map((item) => ({
      item,
      // Pixel y grows downward; panel y grows up.
      x: (item.x + item.w / 2 - (bounds.x + bounds.width / 2)) * scale,
      y: -(item.y + item.h / 2 - (bounds.y + bounds.height / 2)) * scale,
      width: item.w * scale,
      height: item.h * scale,
    }));

  return { width: size.width, height: size.height, places, scale, bounds };
}

/**
 * The item under a point, in uv — the FRONTMOST one.
 *
 * Items overlap on a mood board by design: that is what collage is. The one you
 * can see is the one you meant, so the search runs from the front backwards.
 */
export function moodItemAt(layout: MoodLayout, uv: { x: number; y: number }): MoodPlace | null {
  const point = { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
  for (let i = layout.places.length - 1; i >= 0; i -= 1) {
    const place = layout.places[i];
    if (
      Math.abs(point.x - place.x) <= place.width / 2 &&
      Math.abs(point.y - place.y) <= place.height / 2
    ) {
      return place;
    }
  }
  return null;
}

/**
 * Where the "add a note" strip sits, in panel-local metres.
 *
 * ALONG THE FOOT, the full width. The mood board could be rearranged from the
 * room but not ADDED to, so half of "editable" was missing: you could tidy what
 * somebody else had pinned up and not pin anything yourself.
 *
 * The foot rather than a corner because the fitted board can end anywhere — it
 * is scaled to whatever is on it — and a control that moves as the content
 * grows is one you have to find again every time.
 */
export function moodAddControlOf(layout: MoodLayout, size: MoodSize = MOOD): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const height = Math.min(size.height * 0.11, 0.26);
  return {
    x: 0,
    y: -layout.height / 2 + height / 2,
    width: layout.width,
    height,
  };
}

/** True when a uv point is on the "add a note" strip. */
export function isMoodAdd(layout: MoodLayout, uv: { x: number; y: number }, size: MoodSize = MOOD): boolean {
  const box = moodAddControlOf(layout, size);
  const point = { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
  return Math.abs(point.x - box.x) <= box.width / 2 && Math.abs(point.y - box.y) <= box.height / 2;
}

/**
 * Where a new note goes, in the board's own pixels.
 *
 * BELOW WHAT IS THERE, not on top of it. Dropping a new note at a fixed corner
 * buries it under whatever is already in that corner, and the person who just
 * wrote it cannot see it.
 */
export function moodNextPlace(items: readonly MoodItem[]): { x: number; y: number; w: number; h: number } {
  const bounds = moodBounds(items);
  return { x: Math.round(bounds.x), y: Math.round(bounds.y + bounds.height + 24), w: 260, h: 150 };
}

/**
 * A point in the panel's own frame, as uv.
 *
 * The same rule the work board had to learn: ask from the POINT, not from a
 * mesh's `uv`, because a mood board is made of separate meshes and each one's
 * uv is its own.
 */
export function uvOfMoodPoint(layout: MoodLayout, point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x / layout.width + 0.5, y: point.y / layout.height + 0.5 };
}

/**
 * Turn a drag across the panel back into the board's own pixels.
 *
 * SO A MOVE MEANS THE SAME THING IN BOTH PLACES. Whatever somebody nudges in
 * the room has to land where the website would have put it, or the two views
 * disagree about where things are and every arrangement is undone by whoever
 * looks at it next.
 */
export function moodMove(
  layout: MoodLayout,
  item: MoodItem,
  fromUv: { x: number; y: number },
  toUv: { x: number; y: number },
): { x: number; y: number } {
  const dx = ((toUv.x - fromUv.x) * layout.width) / layout.scale;
  const dy = -((toUv.y - fromUv.y) * layout.height) / layout.scale;
  return { x: Math.round(item.x + dx), y: Math.round(item.y + dy) };
}
