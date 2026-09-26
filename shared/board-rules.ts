/**
 * The rules that used to live in the reducer.
 *
 * ADR-002 retires event sourcing, but the rules it enforced were never about
 * events — they are about what a board is allowed to do. They move here, where
 * the API layer and the UI can both reach them, so a control is never offered
 * for a change the server will refuse.
 */

export const STATUSES = ["backlog", "assigned", "in_progress", "blocked", "review", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const ROLES = ["manager", "ui", "testing", "engineering", "research"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Legal moves: ANY COLUMN TO ANY OTHER.
 *
 * This was a ladder (backlog → assigned → in progress → review → done, with a
 * few ways back), kept so closing a card passed through the states that
 * record who took it and who reviewed it. Nikk (4903, 4936) asked for cards
 * to "be moved freely from any tab to any tab": dragging a card from Blocked
 * to Review and having it refused was the board being in the way. The table
 * stays, and everything still asks it, so a narrower rule can come back in one
 * place.
 */
const ALLOWED: Record<Status, readonly Status[]> = Object.fromEntries(
  STATUSES.map((from) => [from, STATUSES.filter((to) => to !== from)]),
) as unknown as Record<Status, readonly Status[]>;

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED[from].includes(to);
}

export const nextStatuses = (from: Status): readonly Status[] => ALLOWED[from];

/**
 * Keys that must never be stored on a profile, whatever the caller sends.
 *
 * Refused at the boundary rather than hidden at render. "We do not display it"
 * is a promise about one screen; a row that never exists is a promise about the
 * data. Silently stripping is worse than refusing, because the sender is told
 * their field was saved.
 */
export const FORBIDDEN_PROFILE_KEYS = [
  "ip", "ipAddress", "hostname", "host",
  "token", "accessToken", "bearer", "key", "privateKey", "publicKey",
  "password", "secret",
  "latitude", "longitude", "preciseLocation", "coordinates",
] as const;

/**
 * THE SECURITY RULE, kept as a function that cannot be talked out of it.
 *
 * Ownership is not a parameter. It cannot influence the answer, so no future
 * edit can make it influence the answer without deleting this function — which
 * is harder to do by accident than adding a clause.
 */
export function hasProjectAuthority(
  memberships: ReadonlyArray<{ projectId: string; actorId: string; active: boolean }>,
  projectId: string,
  actorId: string,
): boolean {
  return memberships.some((m) => m.projectId === projectId && m.actorId === actorId && m.active);
}

export const isRole = (value: unknown): value is Role => (ROLES as readonly string[]).includes(value as string);
export const isStatus = (value: unknown): value is Status => (STATUSES as readonly string[]).includes(value as string);
