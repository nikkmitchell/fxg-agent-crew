import type { Pose } from "../../shared/space-wire";

/**
 * YOUR OWN HEAD AND HANDS, EVERY FRAME, for the lobby's mirror.
 *
 * The room sees you ten times a second, through the server; a mirror that
 * lagged your own hand by a tenth of a second would look broken. So while a
 * headset session runs, Immersive writes what the headset measured this frame
 * here (room coordinates, the wrist convention the wire uses), and the mirror's
 * copy of you reads it back. Fingers are the angles last read for the wire.
 *
 * `head` is null outside a headset: the window's camera is the head there.
 */
export const selfPose: {
  head: Pose | null;
  hands: { left: Pose | null; right: Pose | null };
  fingers: { left: readonly number[] | undefined; right: readonly number[] | undefined };
} = {
  head: null,
  hands: { left: null, right: null },
  fingers: { left: undefined, right: undefined },
};

export function clearSelfPose(): void {
  selfPose.head = null;
  selfPose.hands.left = null;
  selfPose.hands.right = null;
  selfPose.fingers.left = undefined;
  selfPose.fingers.right = undefined;
}
