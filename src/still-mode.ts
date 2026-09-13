/**
 * Whether this page is being PHOTOGRAPHED rather than used.
 *
 * In a headset the room's panels are stills taken by `tools/render-stills.mts`,
 * not live pages. That changes what belongs on them: every button in a
 * photograph is a button that cannot be pressed, and every heading repeats
 * something the panel already says by being the panel it is. Nikk, looking at
 * the mood board in a headset: "we don't need the text above, also we dont need
 * the add image or anything else in webxr, because its an image you can't click
 * on any buttons."
 *
 * SET BY THE RENDERER, not guessed from the viewport or the user agent. A
 * photograph knows it is a photograph; nothing else has to work it out.
 *
 * NOT THE SAME AS `?embed=1`, which means "no app chrome, just this tab" and is
 * used by the LIVE panels in the window too — those are real pages you can
 * click, and stripping their controls would take away function that works.
 */
export function isStill(scope: { location?: { search?: string } } = globalThis as never): boolean {
  try {
    return new URLSearchParams(scope.location?.search ?? "").get("still") === "1";
  } catch {
    return false;
  }
}
