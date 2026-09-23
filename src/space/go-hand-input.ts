import type { Point3 } from "../../shared/go-layout";
/** Measured XR input, not the rendered hand root and never a remembered pose.
 * Written once by ImmersivePlayer; every table reads the same sample. */
export const goHandInput: Record<"left" | "right", { contact: Point3; carry: Point3; at: number } | null> = { left: null, right: null };
export function clearGoHands() { goHandInput.left = null; goHandInput.right = null; }
