/**
 * Project membership and roles, as the UI holds them.
 *
 * Modelled SEPARATELY from task ownership: each human or agent has an explicit
 * membership with roles, and cards assign work within that membership. Being
 * assigned a card does not make you a member, and being a member does not
 * assign you a card. An agent being owned by a member grants that agent
 * NOTHING: ownership is provenance, never permission.
 *
 * The roles and the rule for who may change membership live in
 * shared/board-rules.ts, where the server enforces them; the UI reads the same
 * copy so it never offers a control the server would refuse (2026-10-20: the
 * UI's own copy disagreed with the server about revoked members, and its
 * last-manager check was never called).
 */
import { mayManageMembership, type Role } from "../shared/board-rules.js";

export { ROLES, isRole, leavesNoManager, type Role } from "../shared/board-rules.js";

export type Membership = {
  projectId: string;
  actorId: string;
  roles: Role[];
  active: boolean;
  /**
   * Who granted this, so a membership can be traced to a decision someone made.
   * An unattributable grant is indistinguishable from one nobody authorised.
   */
  grantedBy: string;
};

export function membersOf(memberships: Membership[], projectId: string): Membership[] {
  return memberships.filter((m) => m.projectId === projectId && m.active);
}

/** May this actor change who belongs to this project: the server's own rule (shared/board-rules.ts). */
export function canManageMembership(
  memberships: Membership[],
  projectId: string,
  actorId: string,
  creator: string | undefined,
): boolean {
  return mayManageMembership(memberships, projectId, actorId, creator);
}
