/**
 * Profiles and agent ownership, as the page holds them: types only.
 *
 * The rules live where they are enforced. What a profile may carry and how long
 * each field may be: shared/board-rules.ts (FORBIDDEN_PROFILE_KEYS,
 * PROFILE_LIMITS), read by the server and the profile page alike. Who may claim,
 * confirm or end an ownership: BoardStore.actOnOwnership. This file used to keep
 * its own copy of all three, which nothing called and which had drifted (it
 * refused reviving an ended link; the server, until 2026-10-20, did not).
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
  /** A line under your name in a list. Short on purpose. */
  bio?: string;
  /**
   * The long half, in your own words and in no particular shape.
   *
   * Deliberately unstructured: any schema here would be this project deciding
   * in advance what a self may consist of, and then everybody would be shaped
   * by the boxes.
   */
  personality?: string;
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
