/**
 * The rules that used to live in the reducer.
 *
 * ADR-002 retires event sourcing, but the rules it enforced were never about
 * events — they are about what a board is allowed to do. They move here, where
 * the API layer and the UI can both reach them, so a control is never offered
 * for a change the server will refuse.
 */

/**
 * ONE PERSON, HOWEVER THEY ARE SPELLED. The room folds case everywhere
 * (shared/space-layout.ts actorKey), and WebHarness has handed the same person
 * over as "Steven" and "steven" five seconds apart; the board compared exactly,
 * so a member signed in under the other spelling was refused their own cards.
 */
export const sameActor = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const STATUSES = ["backlog", "assigned", "in_progress", "blocked", "review", "done"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * WHAT EACH COLUMN IS CALLED, everywhere a person reads it: the web board, the
 * room's board and a card pulled off it into its own panel. Three copies once,
 * and the web board said "In progress" where the room said "Doing"; one now,
 * with the room's word, which fits a column header read in a headset.
 */
export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  backlog: "Backlog",
  assigned: "Assigned",
  in_progress: "Doing",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

/**
 * HOW SOON A CARD MATTERS: 1 is now, 5 is someday, and no priority is
 * "untriaged", which is not the same as unimportant. The server refuses anything
 * else; it once stored the word "normal" on two cards, which SQLite's
 * `priority > 0` check let through (text sorts above every number), and the
 * board then ordered and labelled them as nothing at all.
 */
export const PRIORITY_LABELS: Readonly<Record<number, string>> = { 1: "now", 2: "next", 3: "soon", 4: "later", 5: "someday" };
export const isPriority = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value in PRIORITY_LABELS;

/** The columns, in the order the rules define the statuses. */
export const BOARD_COLUMNS: readonly { status: Status; label: string }[] =
  STATUSES.map((status) => ({ status, label: STATUS_LABELS[status] }));

/**
 * Generous bounds on a card's free text, one copy for the server and the editor.
 *
 * The 2000-character cap was the chat transport's, and removing it was the point
 * of ADR-002 — but "the transport limit is gone" is not "there is no limit".
 * Unbounded text is a storage and context denial-of-service: one client bug
 * writes a 500MB brief, and every reader of that board then pays for it. Chosen
 * far above any honest use; a longer brief is a document and belongs behind a link.
 */
export const BOARD_LIMITS = { description: 100_000, comment: 50_000, title: 500 } as const;

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
/**
 * How long each profile field may be, for the server that refuses a longer one
 * and the page that stops you typing past it. personality gets room because it
 * is the field somebody writes themselves into; a cap that cuts a person off
 * mid-sentence is its own statement. Over the cap is refused, never truncated.
 */
export const PROFILE_LIMITS = { displayName: 120, bio: 600, personality: 8000, short: 120 } as const;

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
  return memberships.some((m) => m.projectId === projectId && sameActor(m.actorId, actorId) && m.active);
}

export const isRole = (value: unknown): value is Role => (ROLES as readonly string[]).includes(value as string);

/** A membership as the store keeps it and the board API hands it to the UI: revoked rows included. */
export type MembershipRow = { projectId: string; actorId: string; roles: readonly string[]; active: boolean };

/**
 * MAY THIS ACTOR CHANGE WHO BELONGS TO THIS PROJECT? One rule, for the server that
 * enforces it and the UI that offers the control (it was two, and they disagreed).
 *
 * A manager may. Nobody else may: not an owner of a member agent, not someone
 * holding a card in the project, not somebody who arrived after the last manager
 * left. THE BOOTSTRAP is a project that has NEVER had a membership row, active or
 * revoked, and only its recorded creator may seed it: otherwise no project could
 * gain its first member, and a project nobody has administered would be anyone's
 * to take. "Never had" and "has none right now" are different, and conflating
 * them was a privilege escalation: revoking the last manager re-opened the
 * bootstrap to anyone. (Making a project makes its creator a manager, so an
 * empty one is a leftover; no recorded creator means nobody may seed it.)
 */
export function mayManageMembership(
  rows: readonly MembershipRow[],
  projectId: string,
  actorId: string,
  creator: string | null | undefined,
): boolean {
  const ofProject = rows.filter((row) => row.projectId === projectId);
  if (ofProject.length === 0) return typeof creator === "string" && sameActor(creator, actorId);
  return ofProject.some((row) => row.active && sameActor(row.actorId, actorId) && row.roles.includes("manager"));
}

/**
 * WOULD THIS CHANGE LEAVE A PROJECT WITH NO MANAGER? Revoking the last one,
 * granting them a set of roles without "manager", or seeding a project's first
 * member without making anybody a manager: each leaves a project nobody can ever
 * administer again (it has had a member, so the bootstrap is closed), a state
 * with no way out that looks like a successful action. Refused.
 */
export function leavesNoManager(
  rows: readonly MembershipRow[],
  projectId: string,
  actorId: string,
  change: { action: "grant"; roles: readonly string[] } | { action: "revoke" },
): boolean {
  const others = rows.filter((row) =>
    row.projectId === projectId && row.active && row.roles.includes("manager") && !sameActor(row.actorId, actorId));
  const stillManages = change.action === "grant" && change.roles.includes("manager");
  return others.length === 0 && !stillManages;
}
export const isStatus = (value: unknown): value is Status => (STATUSES as readonly string[]).includes(value as string);
