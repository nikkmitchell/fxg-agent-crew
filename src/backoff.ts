/**
 * How long to wait before trying a connection again.
 *
 * There were two of these, in the two places that reconnect — the WebHarness
 * long poll and the room's socket. Same shape, different spellings, and each
 * wrong in its own small way: one clamped the bottom of the exponent and let
 * the top run away, the other clamped the top and not the bottom, and they
 * counted attempts from different numbers. Neither mattered yet. Both would
 * have, the first time somebody read one and assumed the other matched.
 *
 * The CAP stays a parameter because the two really do differ, and the reason is
 * worth keeping: a dropped socket should come back quickly because somebody is
 * standing in a room waiting for it, while a long poll that has been failing
 * for a minute is probably failing for a reason that another second will not
 * fix.
 */

/** The first retry waits this long; each one after doubles it. */
const FIRST_MS = 1_000;

/**
 * Delay before retry number `attempt`, counting from one.
 *
 * The exponent is clamped as well as the result. Clamping only the result works
 * — `Math.min` handles Infinity — but it means computing 2 to the power of a
 * number that grows without bound for a tab left open all weekend, which is
 * silly rather than harmful.
 */
export function backoff(attempt: number, capMs: number): number {
  const steps = Math.max(0, Math.min(Math.floor(attempt) - 1, 16));
  return Math.min(FIRST_MS * 2 ** steps, capMs);
}
