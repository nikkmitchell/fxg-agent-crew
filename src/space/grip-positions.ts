/**
 * Where each panel's grab handle is on screen, shared between two renderers.
 *
 * THE PROBLEM THIS SOLVES. The handle has to be DOM: the WebGL canvas is
 * `pointer-events: none` so that the panel iframes stay clickable, which means
 * no 3D object can ever be clicked in a window. But it cannot be drei's
 * `<Html>`, because a second Html in the scene breaks the FIRST one — the
 * panels use `occlude="blending"`, and adding another stopped people being
 * drawn in front of the boards. And it cannot be `createPortal` either: inside
 * a Canvas the reconciler is R3F's, so a `<button>` is read as a three object
 * and the whole scene throws.
 *
 * So the position is computed in the scene, written here, and read by a plain
 * DOM component outside the Canvas. A module-level store rather than props
 * because this is a bridge between two React renderers that cannot see each
 * other, and threading a ref through four components to say the same thing
 * would be more machinery, not less.
 */

export type GripPlace = { id: string; x: number; y: number; shown: boolean };

const places = new Map<string, GripPlace>();
const grabs = new Map<string, (clientX: number, clientY: number) => void>();
const listeners = new Set<() => void>();

/** Called from the scene every frame. Silent when nothing actually moved. */
export function putGrip(place: GripPlace): void {
  const before = places.get(place.id);
  if (
    before &&
    before.shown === place.shown &&
    Math.abs(before.x - place.x) < 0.5 &&
    Math.abs(before.y - place.y) < 0.5
  ) {
    return;
  }
  places.set(place.id, place);
  for (const listener of listeners) listener();
}

export function dropGrip(id: string): void {
  places.delete(id);
  grabs.delete(id);
  for (const listener of listeners) listener();
}

/** What to call when somebody takes hold of a panel's handle. */
export function onGrabOf(id: string, grab: (clientX: number, clientY: number) => void): void {
  grabs.set(id, grab);
}

export function grabWith(id: string, clientX: number, clientY: number): void {
  grabs.get(id)?.(clientX, clientY);
}

export function allGrips(): GripPlace[] {
  return [...places.values()];
}

export function subscribeGrips(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
