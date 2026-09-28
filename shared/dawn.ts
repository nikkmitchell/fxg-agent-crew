/** Dawn is one shared room event, so its schedule is UTC—not each viewer's clock. */
export const DAWN_START_UTC_MINUTE = 22 * 60;
export const DAWN_RISE_MINUTES = 10;
export const DAWN_SET_START_UTC_MINUTE = 10 * 60;
export const DAWN_SET_MINUTES = 10;

function smoothstep(t: number): number {
  const bounded = Math.max(0, Math.min(1, t));
  return bounded * bounded * (3 - 2 * bounded);
}

/**
 * The room's shared warmth at one UTC instant: sunrise at 22:00, daylight
 * through midnight, and dusk at 10:00 UTC. The two transitions wrap midnight.
 */
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

  // A reduced-motion session sees a steady endpoint instead of either ramp.
  const inDaylight = minute >= DAWN_START_UTC_MINUTE || minute < setEnd;
  if (reducedMotion) return inDaylight ? 1 : 0;

  if (minute >= DAWN_START_UTC_MINUTE && minute < riseEnd) {
    return smoothstep((minute - DAWN_START_UTC_MINUTE) / DAWN_RISE_MINUTES);
  }
  if (minute >= riseEnd || minute < DAWN_SET_START_UTC_MINUTE) return 1;
  if (minute < setEnd) return 1 - smoothstep((minute - DAWN_SET_START_UTC_MINUTE) / DAWN_SET_MINUTES);
  return 0;
}

/** Show the next shared UTC dawn and its equivalent time in a viewer's zone. */
export function dawnScheduleLabelAt(epochMs: number, timeZone?: string): string {
  if (!Number.isFinite(epochMs)) return "22:00 UTC";
  const now = new Date(epochMs);
  if (Number.isNaN(now.getTime())) return "22:00 UTC";

  const nextDawn = new Date(now);
  nextDawn.setUTCHours(DAWN_START_UTC_MINUTE / 60, 0, 0, 0);
  if (nextDawn.getTime() <= now.getTime()) nextDawn.setUTCDate(nextDawn.getUTCDate() + 1);

  try {
    const localTime = new Intl.DateTimeFormat("en-GB", {
      ...(timeZone ? { timeZone } : {}),
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(nextDawn);
    return `22:00 UTC (${localTime} your time)`;
  } catch {
    return "22:00 UTC";
  }
}
