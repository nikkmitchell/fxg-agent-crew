export type TaskAge = { relative: string; absolute: string };

/** A compact elapsed-time label plus an exact, local timestamp for hover/assistive text. */
export function taskAgeStamp(createdAt?: string, nowMs = Date.now()): TaskAge | null {
  if (!createdAt) return null;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return null;

  const ageMs = Math.max(0, nowMs - createdMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let relative: string;

  if (ageMs < minute) relative = "just now";
  else if (ageMs < hour) relative = `${Math.floor(ageMs / minute)}m ago`;
  else if (ageMs < day) relative = `${Math.floor(ageMs / hour)}h ago`;
  else if (ageMs < 30 * day) relative = `${Math.floor(ageMs / day)}d ago`;
  else if (ageMs < 365 * day) relative = `${Math.floor(ageMs / (30 * day))}mo ago`;
  else relative = `${Math.floor(ageMs / (365 * day))}y ago`;

  const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(createdMs));
  return { relative, absolute };
}
