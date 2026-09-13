import { PANEL_SCALE } from "../../shared/panel-place";

/**
 * How big a panel becomes as you drag to resize it.
 *
 * THE GESTURE IS "PULL IT BIGGER". You take hold of the panel and the distance
 * from its middle to where you are pointing sets the size: drag away and it
 * grows, drag back and it shrinks, in proportion. It works from a controller
 * ray across the room exactly as it works from a mouse, which matters because
 * the headset is where this is actually wanted and there is no corner handle
 * small enough to grab from four metres away.
 *
 * PROPORTIONAL RATHER THAN ABSOLUTE, so it does not matter where on the panel
 * you took hold: what counts is how much further out you have pulled than where
 * you started, which is the thing your hand is doing.
 *
 * `grabbed` has a floor because somebody who grabs the exact middle of a panel
 * starts at zero distance, and every later position would then be infinitely
 * bigger. A quarter of a metre is close enough to the middle to be a grab at
 * the middle, and treating it as such makes the panel simply not resize rather
 * than explode.
 */
const CLOSEST_GRAB = 0.25;

export function resizedScale(startScale: number, grabbed: number, now: number): number {
  const from = Math.max(grabbed, CLOSEST_GRAB);
  const to = Math.max(now, CLOSEST_GRAB);
  const wanted = startScale * (to / from);
  if (!Number.isFinite(wanted)) return startScale;
  return Math.min(PANEL_SCALE.max, Math.max(PANEL_SCALE.min, wanted));
}
