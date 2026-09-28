/**
 * Buttons you press by touching them, not by pointing at them.
 *
 * Nikk (4761, 4763): the gear and the mic below you should be "colliders so
 * that your pointer goes right through them and you just need to touch it with
 * the tip of your finger ... either finger point touch, or controller hit, so
 * users just touch it as a button".
 *
 * WHY NOT THE POINTER LIBRARY'S OWN TOUCH. Denying the laser on these buttons
 * (3a80440) was not enough: each hand also carries a grab sphere, only the
 * nearest pointer is live, and with the buttons at the chest the sphere touched
 * them and switched the laser off. And a controller has no fingertip pointer at
 * all. So pointer events on these buttons are off entirely, and a press is
 * measured here from where the fingertip (a hand) or the grip (a controller)
 * actually is.
 *
 * PURE, so "one touch is one press" is tested rather than hoped for.
 */

export type Point = { x: number; y: number; z: number };
export type TouchButton = { id: string; at: Point; radius: number };

/** How far past its own edge a button counts a fingertip as touching it. */
export const TOUCH_MARGIN = 0.015;
/** Within this, a hand is "near" and the buttons light up to full strength. */
export const NEAR = 0.2;
/** A single physical press can also produce a pointer click in the same beat. */
export const DUPLICATE_ACTIVATION_MS = 250;

export function isDuplicateActivation(previousAt: number, now: number): boolean {
  return now - previousAt < DUPLICATE_ACTIVATION_MS;
}

/**
 * Which buttons were pressed this frame.
 *
 * A PRESS IS ENTERING, NOT BEING INSIDE. A finger resting on a button would
 * otherwise press it ninety times a second; it presses once, on the way in,
 * and has to leave before it can press again.
 */
export function touchPresses(
  buttons: readonly TouchButton[],
  contacts: readonly (Point | null)[],
  wasInside: ReadonlySet<string>,
): { pressed: string[]; inside: Set<string> } {
  const inside = new Set<string>();
  for (const button of buttons) {
    for (const contact of contacts) {
      if (contact && distance(contact, button.at) <= button.radius + TOUCH_MARGIN) {
        inside.add(button.id);
        break;
      }
    }
  }
  const pressed = [...inside].filter((id) => !wasInside.has(id));
  return { pressed, inside };
}

/** Whether any hand is close enough to the buttons for them to show fully. */
export function handNear(buttons: readonly TouchButton[], contacts: readonly (Point | null)[]): boolean {
  return buttons.some((button) => contacts.some((contact) => contact !== null && distance(contact, button.at) <= NEAR));
}

/**
 * How visible the buttons are while no hand is near. Nikk (4761): "their
 * transparency when you are not touching them to be at 30% of what it is now".
 */
export const IDLE_OPACITY = 0.3;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * WHICH CLOSED BUTTONS EXIST, for drawing them and for touching them alike.
 * Two lists drifted: with hands in view talk and cancel were not drawn but
 * could still be touched, an invisible button beside the gear that started a
 * recording (Nikk, 5125). With hands, the gesture talks and cancels.
 */
/**
 * The touch talk and cancel buttons, ONLY while controllers are confirmed in
 * use. `handsInView` is true unless a controller is connected: bare hands
 * that have dropped out of tracking still get no buttons (Nikk, 2026-09-28).
 */
export function closedButtons(handsInView: boolean, cancellable: boolean): Array<"talk" | "cancel"> {
  // THE GEAR IS NOT DOWN HERE ANY MORE: it appears when you look up (Nikk,
  // 5245; see control-pose.ts lookingUp). With hands the gesture talks, so the
  // pair below is empty.
  if (handsInView) return [];
  return cancellable ? ["talk", "cancel"] : ["talk"];
}

/**
 * Whether the status line under you should take presses at all: only when it
 * offers the update, or shows a draft you can open to fix. Everything else is
 * words to read, and presses go through to what is behind (Nikk, 2026-09-28).
 */
export function statusLineActionable({ updateOffered, showingDraft }: { updateOffered: boolean; showingDraft: boolean }): boolean {
  return updateOffered || showingDraft;
}
