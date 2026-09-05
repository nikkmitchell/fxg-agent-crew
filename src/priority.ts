import type { CrewTask } from "./event-core";

export const PRIORITY_LABELS: Record<number, string> = {
  1: "now",
  2: "next",
  3: "soon",
  4: "later",
  5: "someday",
};

/**
 * Order cards so an agent can pick the next thing without being told.
 *
 * UNSET IS NOT LOWEST. Cards nobody has triaged sort after the triaged ones but
 * keep their own group, rather than being buried at the bottom of priority 5 —
 * an untriaged card is not a card judged unimportant, and treating them the same
 * hides exactly the work most likely to need a decision.
 *
 * Ties break by id so the order is stable between renders. Without that, two
 * cards of equal priority can swap places on every poll, which now happens
 * every fifteen seconds and would make the board visibly restless.
 */
export function byPriority(tasks: CrewTask[]): CrewTask[] {
  return [...tasks].sort((a, b) => {
    const pa = a.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * What an agent should pick up next: the highest-priority unclaimed card.
 *
 * Returns null rather than a guess when nothing is available. "Nothing is
 * unclaimed" is a real answer and a useful one — it means the board is fully
 * taken, not that the function failed.
 */
export function nextUnclaimed(tasks: CrewTask[]): CrewTask | null {
  const available = byPriority(tasks).filter(
    (task) => (task.owners ?? []).length === 0 && task.status !== "done",
  );
  return available[0] ?? null;
}

export function priorityLabel(priority: number | undefined): string {
  return priority === undefined ? "unset" : (PRIORITY_LABELS[priority] ?? String(priority));
}
