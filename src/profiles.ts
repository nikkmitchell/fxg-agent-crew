/**
 * Profiles and agent ownership.
 *
 * Implements the persistence and authority half of the profile architecture
 * recorded on saha-agent-profiles. The UI half is not here.
 *
 * The rule that shapes everything below, stated in that architecture and worth
 * repeating where it is enforced: HUMAN OWNERSHIP OF AN AGENT NEVER GRANTS THAT
 * AGENT PROJECT AUTHORITY. Ownership is lineage — who is answerable for this
 * instrument — not permission. An agent needs its own explicit membership.
 */

export type ActorKind = "human" | "agent";

/** pending until the other side confirms; revoked keeps the history. */
export type OwnershipState = "pending" | "verified" | "revoked";

export type ActorProfile = {
  /**
   * Stable and never displayed as a name. Display names change; this does not,
   * so a rename cannot orphan ownership, authorship or membership.
   */
  actorId: string;
  kind: ActorKind;
  displayName: string;
  bio?: string;
  /** Coarse only — a city or region. Never a precise location. */
  coarseLocation?: string;
  timeZone?: string;
  /** Agent-only, and only when the operator chose to publish them. */
  model?: string;
  runtime?: string;
};

export type Ownership = {
  agentActorId: string;
  ownerActorId: string;
  state: OwnershipState;
};

/**
 * Fields that must never be accepted into a profile, whatever the caller says.
 *
 * Not a display concern — a storage one. Once a hostname or a token is in the
 * durable log it is in every replay forever, and "we do not render it" is a
 * promise about one screen rather than about the data. Refusing at the boundary
 * is the only version that survives someone writing a second screen.
 */
const FORBIDDEN_KEYS = [
  "ip",
  "ipAddress",
  "hostname",
  "host",
  "token",
  "accessToken",
  "bearer",
  "key",
  "privateKey",
  "publicKey",
  "password",
  "secret",
  "latitude",
  "longitude",
  "preciseLocation",
  "coordinates",
];

export type Rejected = { ok: false; reason: string };
export type Accepted<T> = { ok: true; value: T };
export type Checked<T> = Accepted<T> | Rejected;

const MAX = { id: 128, name: 120, bio: 600, short: 120 };

const text = (raw: unknown, label: string, max: number, required = true): Checked<string | undefined> => {
  if (raw === undefined || raw === null) {
    return required ? { ok: false, reason: `${label} is required` } : { ok: true, value: undefined };
  }
  if (typeof raw !== "string") return { ok: false, reason: `${label} is not a string` };
  const value = raw.trim();
  if (required && value.length === 0) return { ok: false, reason: `${label} may not be empty` };
  if (value.length > max) return { ok: false, reason: `${label} exceeds ${max} characters` };
  return { ok: true, value: value.length === 0 ? undefined : value };
};

export function checkProfile(raw: unknown): Checked<ActorProfile> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "profile is not an object" };
  }
  const o = raw as Record<string, unknown>;

  // Refused before anything else. A profile carrying a hostname is rejected
  // entirely rather than quietly stripped: silently dropping a field tells the
  // sender it was stored, and they will believe it.
  for (const key of Object.keys(o)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      return { ok: false, reason: `profile.${key} may never be stored` };
    }
  }

  const actorId = text(o.actorId, "profile.actorId", MAX.id);
  if (!actorId.ok) return actorId;
  if (o.kind !== "human" && o.kind !== "agent") {
    return { ok: false, reason: 'profile.kind must be "human" or "agent"' };
  }
  const displayName = text(o.displayName, "profile.displayName", MAX.name);
  if (!displayName.ok) return displayName;

  const optional = (key: keyof ActorProfile, max: number) => text(o[key], `profile.${key}`, max, false);
  const bio = optional("bio", MAX.bio);
  if (!bio.ok) return bio;
  const coarseLocation = optional("coarseLocation", MAX.short);
  if (!coarseLocation.ok) return coarseLocation;
  const timeZone = optional("timeZone", MAX.short);
  if (!timeZone.ok) return timeZone;
  const model = optional("model", MAX.short);
  if (!model.ok) return model;
  const runtime = optional("runtime", MAX.short);
  if (!runtime.ok) return runtime;

  if (o.kind === "human" && (model.value !== undefined || runtime.value !== undefined)) {
    return { ok: false, reason: "model and runtime describe an agent runtime, not a person" };
  }

  return {
    ok: true,
    value: {
      actorId: actorId.value as string,
      kind: o.kind,
      displayName: displayName.value as string,
      ...(bio.value !== undefined ? { bio: bio.value } : {}),
      ...(coarseLocation.value !== undefined ? { coarseLocation: coarseLocation.value } : {}),
      ...(timeZone.value !== undefined ? { timeZone: timeZone.value } : {}),
      ...(model.value !== undefined ? { model: model.value } : {}),
      ...(runtime.value !== undefined ? { runtime: runtime.value } : {}),
    },
  };
}

/**
 * Declaring ownership is a REQUEST, not a fact.
 *
 * A human declaring "that agent is mine" starts as pending. Anyone can say it;
 * saying it does not make it so. Only the agent confirming makes it verified —
 * which is the same boundary the rest of this system holds, that a validated
 * message is not an authorised one.
 */
export function declareOwnership(agentActorId: string, ownerActorId: string): Ownership {
  return { agentActorId, ownerActorId, state: "pending" };
}

export function confirmOwnership(ownership: Ownership, confirmingActorId: string): Ownership {
  // Only the agent itself can confirm. A human confirming their own claim would
  // make the pending state decorative.
  if (confirmingActorId !== ownership.agentActorId) return ownership;
  if (ownership.state === "revoked") return ownership;
  return { ...ownership, state: "verified" };
}

export function revokeOwnership(ownership: Ownership, revokingActorId: string): Ownership {
  // Either side may end it. Neither side can end it on the other's behalf.
  if (revokingActorId !== ownership.agentActorId && revokingActorId !== ownership.ownerActorId) {
    return ownership;
  }
  return { ...ownership, state: "revoked" };
}

/**
 * Agents this human is answerable for. Revoked links are excluded from the
 * present, but the events that recorded them are not deleted — historical
 * authorship survives revocation, so who wrote what stays true.
 */
export function agentsOwnedBy(ownerActorId: string, ownerships: Ownership[]): Ownership[] {
  return ownerships.filter((o) => o.ownerActorId === ownerActorId && o.state !== "revoked");
}

/**
 * THE SECURITY RULE, as executable code rather than a sentence in a document.
 *
 * Ownership is deliberately not an input. It cannot influence the answer, so no
 * future change can make it influence the answer without deleting this
 * function and its test.
 */
export function projectAuthority(
  actorId: string,
  memberships: Array<{ projectId: string; actorId: string; active: boolean }>,
  projectId: string,
): boolean {
  return memberships.some((m) => m.projectId === projectId && m.actorId === actorId && m.active);
}
