import type { Actor } from "./People";

/**
 * Group people and the agents they operate.
 *
 * From the profile architecture: "lineage, not leaderboard". A human identity is
 * the root; agents they operate are linked instruments, not competing persona
 * cards. A flat list of everyone gives a reader no way to tell that six of the
 * eight names belong to two people.
 */
export type Lineage = {
  root: Actor;
  /** Agents this person operates, on a link BOTH sides have confirmed. */
  instruments: Actor[];
};

/**
 * Only VERIFIED links nest.
 *
 * A pending claim is a request, not a fact — anyone can declare that an agent is
 * theirs, and only the agent confirming makes it so. profiles.ts already refuses
 * to treat the claim as established; drawing the agent underneath the claimant
 * would undo that in the one place a person actually looks. A pending link still
 * shows on the agent's own card, where it reads as the claim it is.
 *
 * An agent whose owner is not on the list stays a root too, rather than
 * disappearing into a parent that is not there to be seen.
 */
export function groupByLineage(actors: Actor[]): Lineage[] {
  const present = new Set(actors.map((actor) => actor.username));

  const ownerOf = (actor: Actor): string | undefined => {
    const link = actor.ownedBy;
    if (!link || link.state !== "verified") return undefined;
    return present.has(link.ownerActorId) ? link.ownerActorId : undefined;
  };

  const instruments = new Map<string, Actor[]>();
  const roots: Actor[] = [];

  for (const actor of actors) {
    const owner = ownerOf(actor);
    if (owner === undefined || owner === actor.username) {
      roots.push(actor);
      continue;
    }
    const existing = instruments.get(owner) ?? [];
    existing.push(actor);
    instruments.set(owner, existing);
  }

  return roots
    .map((root) => ({
      root,
      instruments: (instruments.get(root.username) ?? []).sort((a, b) =>
        a.username.localeCompare(b.username),
      ),
    }))
    .sort((a, b) => a.root.username.localeCompare(b.root.username));
}
