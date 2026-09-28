/** The room-owned civil clock for its shared daily dawn (not each device's zone). */
export const DAWN_TIME_ZONE = "Asia/Shanghai";
export const DAWN_START_LOCAL_MINUTE = 6 * 60;
export const DAWN_RISE_MINUTES = 10;
export const DAWN_SET_START_LOCAL_MINUTE = 18 * 60;
export const DAWN_SET_MINUTES = 10;

const formatters = new Map<string, Intl.DateTimeFormat>();
const localMinuteCache = new Map<string, { epochSecond: number; minute: number }>();

function smoothstep(t: number): number {
  const bounded = Math.max(0, Math.min(1, t));
  return bounded * bounded * (3 - 2 * bounded);
}

function localMinuteAt(at: Date, timeZone: string): number | null {
  const epochSecond = Math.floor(at.getTime() / 1_000);
  const cached = localMinuteCache.get(timeZone);
  if (cached?.epochSecond === epochSecond) {
    return cached.minute + at.getUTCMilliseconds() / 60_000;
  }

  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return null;
    }
    formatters.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  if (![hour, minute, second].every(Number.isFinite)) return null;
  const localMinute = (hour % 24) * 60 + minute + second / 60;
  localMinuteCache.set(timeZone, { epochSecond, minute: localMinute });
  return localMinute + at.getUTCMilliseconds() / 60_000;
}

/** Warmth from 0..1 on the room's IANA clock; all devices share the same zone and phase. */
export function dawnWarmthAt(epochMs: number, reducedMotion = false, timeZone = DAWN_TIME_ZONE): number {
  if (!Number.isFinite(epochMs)) return 0;
  const at = new Date(epochMs);
  if (Number.isNaN(at.getTime())) return 0;
  const minute = localMinuteAt(at, timeZone);
  if (minute === null) return 0;
  const riseEnd = DAWN_START_LOCAL_MINUTE + DAWN_RISE_MINUTES;
  const setEnd = DAWN_SET_START_LOCAL_MINUTE + DAWN_SET_MINUTES;

  // A reduced-motion session sees a steady endpoint for its whole visit; it
  // does not animate through either the rise or the settling of the light.
  if (reducedMotion) return minute >= DAWN_START_LOCAL_MINUTE && minute < setEnd ? 1 : 0;

  if (minute < DAWN_START_LOCAL_MINUTE || minute >= setEnd) return 0;
  if (minute < riseEnd) return smoothstep((minute - DAWN_START_LOCAL_MINUTE) / DAWN_RISE_MINUTES);
  if (minute < DAWN_SET_START_LOCAL_MINUTE) return 1;
  return 1 - smoothstep((minute - DAWN_SET_START_LOCAL_MINUTE) / DAWN_SET_MINUTES);
}
