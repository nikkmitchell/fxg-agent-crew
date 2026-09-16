/**
 * Whether the room must turn teleport on whatever the setting says.
 *
 * THE EXCEPTION EXISTS because the XREAL Aura has no thumbsticks: without
 * teleport, Nikk could not move at all. "A controller with no stick means
 * teleport is the only way to move" seemed obviously right when I wrote it.
 *
 * IT WAS TOO BROAD, and it spent the morning throwing people across the room
 * during their own onboarding. From the journal, with Nikk's setting OFF:
 *
 *   Nikk2: teleported 7.97 m to (-0.07, 0.04); hands -R, controllers L-, setting off, teleport on
 *   KANxD: teleported 6.32 m to (0.02, -0.12); hands L-, controllers -R, setting off, teleport on
 *
 * Read the hands column. Both of them had A HAND TRACKED — so the palm joystick
 * worked and teleport was NOT their only way to move. The question the code
 * asked was "does this controller have a stick". The question that matters is
 * "does this person have any other way to move at all".
 *
 * TWO THINGS THIS IS CAREFUL ABOUT:
 *
 * HANDS ARE LATCHED. Tracking drops for a moment when a hand leaves the
 * cameras' view, and a teleport that switches itself on during that moment is
 * the bug again in miniature. Once a hand has been seen this session, the
 * person has another way to move.
 *
 * ABSENCE OF INFORMATION IS NOT ABSENCE OF A STICK. `gamepad` is populated from
 * the device profile, which arrives asynchronously; an empty or missing one
 * means "not known yet", and reading that as "no thumbstick" would turn
 * teleport on for a moment on every Quest. It must be positively known.
 */

export type ControllerLike = { gamepad?: Record<string, unknown> } | undefined;

const THUMBSTICK = "xr-standard-thumbstick";

/** Known to be a controller with no thumbstick — not merely unreported. */
export function lacksThumbstick(controller: ControllerLike): boolean {
  if (!controller?.gamepad) return false;
  const named = Object.keys(controller.gamepad);
  if (named.length === 0) return false;
  return controller.gamepad[THUMBSTICK] === undefined;
}

/** Known to have a thumbstick — so there is a way to move that is not teleport. */
export function hasThumbstick(controller: ControllerLike): boolean {
  return controller?.gamepad?.[THUMBSTICK] !== undefined;
}

export function teleportIsTheOnlyWayToMove(input: {
  controllers: ControllerLike[];
  /** Whether a tracked hand has been seen at any point this session. */
  handsSeen: boolean;
}): boolean {
  if (input.handsSeen) return false;
  const connected = input.controllers.filter((controller) => controller !== undefined);
  if (connected.length === 0) return false;
  // ONE STICK IS ENOUGH. A pair where only one profile has loaded is the common
  // case, and "some controller lacks a stick" was true of it — which would have
  // turned teleport on for somebody holding a working thumbstick. My own test
  // caught that; the implementation was eager and the assertion was right.
  if (connected.some(hasThumbstick)) return false;
  return connected.some(lacksThumbstick);
}
