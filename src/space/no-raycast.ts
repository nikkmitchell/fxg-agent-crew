/**
 * A mesh that is only scenery and must never catch a pointer: give it this as its
 * `raycast`. A controller ray, a mouse or a fingertip then passes through to
 * whatever is behind it (a board's face, a stone, a button) instead of stopping
 * on a glow, a label or a decorative rim. One rule, used by every scene piece,
 * where it had been rewritten in sixteen files (2026-10-22).
 */
export const noRaycast = (): void => undefined;
