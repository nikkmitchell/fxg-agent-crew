/**
 * The room's shared daily dawn. All times are UTC so everyone sees the same
 * phase; the client aligns its clock to the room server before rendering.
 */
export const DAWN_START_UTC_MINUTE = 6 * 60;
export const DAWN_RISE_MINUTES = 10;
export const DAWN_SET_START_UTC_MINUTE = 18 * 60;
export const DAWN_SET_MINUTES = 10;

function smoothstep(t: number): number {
  const bounded = Math.max(0, Math.min(1, t));
  return bounded * bounded * (3 - 2 * bounded);
}

/** Warmth from 0..1 at a UTC instant; dawn rises for ten minutes, dusk settles for ten. */
export function dawnWarmthAt(epochMs: number, reducedMotion = false): number {
  if (!Number.isFinite(epochMs)) return 0;
  const at = new Date(epochMs);
  if (Number.isNaN(at.getTime())) return 0;
  const minute = at.getUTCHours() * 60
    + at.getUTCMinutes()
    + at.getUTCSeconds() / 60
    + at.getUTCMilliseconds() / 60_000;
  const riseEnd = DAWN_START_UTC_MINUTE + DAWN_RISE_MINUTES;
  const setEnd = DAWN_SET_START_UTC_MINUTE + DAWN_SET_MINUTES;

  // A reduced-motion session sees a steady endpoint for its whole visit; it
  // does not animate through either the rise or the settling of the light.
  if (reducedMotion) return minute >= DAWN_START_UTC_MINUTE && minute < setEnd ? 1 : 0;

  if (minute < DAWN_START_UTC_MINUTE || minute >= setEnd) return 0;
  if (minute < riseEnd) return smoothstep((minute - DAWN_START_UTC_MINUTE) / DAWN_RISE_MINUTES);
  if (minute < DAWN_SET_START_UTC_MINUTE) return 1;
  return 1 - smoothstep((minute - DAWN_SET_START_UTC_MINUTE) / DAWN_SET_MINUTES);
}
