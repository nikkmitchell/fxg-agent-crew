/**
 * Stable, sparse links for the shared-breath Air Weave.
 *
 * A room of people is not a complete graph: drawing every pair makes a net,
 * not a thread. Sorting once and joining neighbours into a ring gives the
 * group one quiet circuit, independent of join order and without privileging
 * one participant as the centre.
 */
export type AirWeaveLink = readonly [from: string, to: string];

export function airWeaveLinks(actorIds: readonly string[]): AirWeaveLink[] {
  const ids = [...new Set(actorIds.filter((id) => id.length > 0))].sort();
  if (ids.length < 2) return [];
  if (ids.length === 2) return [[ids[0], ids[1]]];
  return ids.map((id, index) => [id, ids[(index + 1) % ids.length]] as const);
}
