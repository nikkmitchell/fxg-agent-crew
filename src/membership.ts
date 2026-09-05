/**
 * Project membership and roles.
 *
 * Modelled SEPARATELY from task ownership, per the design constraint recorded
 * on the card: each human or agent has an explicit membership with roles, and
 * cards assign work within that membership. Being assigned a card does not make
 * you a member, and being a member does not assign you a card.
 *
 * And the rule that has been repeated at every layer of this system: an agent
 * being owned by a member grants that agent NOTHING. Ownership is provenance —
 * who is answerable for this instrument — never permission.
 */

export type Role = "manager" | "ui" | "testing" | "engineering" | "research";

export const ROLES: readonly Role[] = ["manager", "ui", "testing", "engineering", "research"];

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

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export function membersOf(memberships: Membership[], projectId: string): Membership[] {
  return memberships.filter((m) => m.projectId === projectId && m.active);
}

export function membershipFor(
  memberships: Membership[],
  projectId: string,
  actorId: string,
): Membership | undefined {
  return memberships.find((m) => m.projectId === projectId && m.actorId === actorId && m.active);
}

export function hasRole(
  memberships: Membership[],
  projectId: string,
  actorId: string,
  role: Role,
): boolean {
  return membershipFor(memberships, projectId, actorId)?.roles.includes(role) ?? false;
}

/**
 * May this actor change who belongs to this project?
 *
 * A manager may. Nobody else may — not an owner of a member agent, not someone
 * who happens to hold a card in the project, not the person who created the
 * task you are looking at.
 *
 * THE BOOTSTRAP: a project with no members yet can be joined by its creator,
 * because otherwise no project could ever gain its first member. That is a real
 * hole if creation is unattributed, which is why the caller must pass the
 * project's recorded creator rather than assuming the requester is it.
 */
export function canManageMembership(
  memberships: Membership[],
  projectId: string,
  actorId: string,
  projectCreatedBy: string | undefined,
): boolean {
  const existing = membersOf(memberships, projectId);
  if (existing.length === 0) return projectCreatedBy !== undefined && actorId === projectCreatedBy;
  return hasRole(memberships, projectId, actorId, "manager");
}

export type MembershipChange =
  | { ok: true; value: Membership[] }
  | { ok: false; reason: string };

/**
 * Grant or update a membership.
 *
 * Revocation is a flag, never a deletion: a removed member's past authorship
 * must remain explicable, and a deleted row makes yesterday's decisions look
 * like they came from nobody.
 */
export function grantMembership(
  memberships: Membership[],
  grant: { projectId: string; actorId: string; roles: Role[] },
  grantedBy: string,
  projectCreatedBy: string | undefined,
): MembershipChange {
  if (!canManageMembership(memberships, grant.projectId, grantedBy, projectCreatedBy)) {
    return { ok: false, reason: `${grantedBy} may not manage membership of ${grant.projectId}` };
  }
  if (grant.roles.length === 0) {
    // A member with no role is a member who can do nothing and means nothing;
    // it is almost certainly a mistake rather than an intent.
    return { ok: false, reason: "a membership needs at least one role" };
  }

  const others = memberships.filter(
    (m) => !(m.projectId === grant.projectId && m.actorId === grant.actorId),
  );
  return {
    ok: true,
    value: [...others, { ...grant, active: true, grantedBy }],
  };
}

export function revokeMembership(
  memberships: Membership[],
  projectId: string,
  actorId: string,
  revokedBy: string,
  projectCreatedBy: string | undefined,
): MembershipChange {
  if (!canManageMembership(memberships, projectId, revokedBy, projectCreatedBy)) {
    return { ok: false, reason: `${revokedBy} may not manage membership of ${projectId}` };
  }

  const managers = membersOf(memberships, projectId).filter((m) => m.roles.includes("manager"));
  if (managers.length === 1 && managers[0].actorId === actorId) {
    // Removing the last manager leaves a project nobody can ever administer
    // again — a state with no way out that looks like a successful action.
    return { ok: false, reason: "cannot remove the last manager of a project" };
  }

  return {
    ok: true,
    value: memberships.map((m) =>
      m.projectId === projectId && m.actorId === actorId ? { ...m, active: false } : m,
    ),
  };
}
