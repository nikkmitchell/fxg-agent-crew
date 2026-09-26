/**
 * Scrolling the chat wall in a headset. Nikk, 2026-09-26 (4936): "the chat in
 * XR should show the entire messages and as well allow for a scroll ... to
 * scroll up through the messages and that scroll doesn't need to be networked
 * ... when a new message comes it should automatically scroll down to the
 * bottom".
 *
 * The scroll is one number, `up`: how many canvas pixels the view is lifted off
 * the newest message. 0 is pinned to the bottom, which is where the wall rests
 * and where it returns whenever something new is said. It lives in the viewer's
 * own page only: nobody else's wall moves when you read back.
 *
 * Pure, so the arithmetic is tested without a canvas (chat-scroll.test.ts).
 */

/** Keep `up` between the newest message (0) and the oldest one at the top. */
export function clampScroll(up: number, content: number, view: number): number {
  return Math.max(0, Math.min(up, Math.max(0, content - view)));
}

/**
 * A drag on the wall, like a phone: pull the conversation down to read what
 * came before, push it up to come back. `fromV` and `toV` are the panel's own
 * v (0 at the bottom edge, 1 at the top), `viewPixels` is the canvas height the
 * panel shows.
 */
export function dragScroll(start: number, fromV: number, toV: number, viewPixels: number, content: number): number {
  return clampScroll(start + (fromV - toV) * viewPixels, content, viewPixels);
}

/** A mouse wheel or trackpad: a third of the wall per notch, the usual way round. */
export function wheelScroll(up: number, deltaY: number, viewPixels: number, content: number): number {
  return clampScroll(up - Math.sign(deltaY) * viewPixels / 3, content, viewPixels);
}

/**
 * The scroll bar down the wall's edge: where its thumb sits and how long it
 * is, both 0..1 of the track from the top. Null when everything fits and there
 * is nothing to scroll.
 */
export function scrollThumb(up: number, content: number, view: number): { from: number; length: number } | null {
  if (content <= view) return null;
  const length = Math.max(0.08, view / content);
  const travel = content - view;
  const from = (1 - length) * (1 - clampScroll(up, content, view) / travel);
  return { from, length };
}

/** A drag moves the wall only once it has clearly gone up or down, not on a tap. */
export const CHAT_DRAG_SLOP = 0.015;
