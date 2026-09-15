import type { CrewTask } from "./event-core";

/**
 * The order cards stack in a column: newest arrival first.
 *
 * Nikk, in the room: "have the tabs inside of the work board to begin from the
 * bottom and then move upwards... put [the titles] on the very bottom and then
 * have the top tabs moving up from them and have new tabs appear at the bottom
 * when the agents go to them".
 *
 * So a column is a stack standing on its title. The card that arrived last sits
 * right on the title, where an agent walking up to the board puts it, and
 * everything older is pushed up. The first card in this order is the one
 * drawn at the bottom; the column is laid out `column-reverse`.
 *
 * WHEN A CARD ARRIVED is the moment it changed column (`fresh.changedAt`, kept
 * for recent changes) or, failing that, the last time its row changed, which
 * a move always does. Ties break by id, so two cards moved in the same second
 * do not swap places on every poll.
 *
 * NOT PRIORITY ANY MORE, for the stack. Priority still decides "Next unclaimed"
 * on the board bar and is still printed on every card; it no longer decides
 * where a card is drawn, because a board where a newly placed card could land
 * anywhere in its column cannot show a card arriving.
 */
export function byArrival(tasks: CrewTask[]): CrewTask[] {
  const arrived = (task: CrewTask) => Date.parse(task.fresh?.changedAt ?? task.updatedAt ?? "") || 0;
  return [...tasks].sort((a, b) => arrived(b) - arrived(a) || a.id.localeCompare(b.id));
}
