/**
 * FINISHED SPACES (Nikk, 6940): an experience made on the things framework (a
 * space, with its items, environment and script), published as a saha.ing
 * room of its own. It is pinned to one deploy, so a push to its branch never
 * changes what visitors see until someone presses Update; and inside it the
 * work controls are hidden: no work panels, no Library, no ⚙ on things.
 *
 * The room selector shows them on their own tab, apart from the work rooms.
 */
export type FinishedSpace = {
  /** The saha.ing (WebHarness) room it is, made public when it was published. */
  room: string;
  title: string;
  /** Where its one thing comes from, and the deploy it is pinned to. */
  space: string;
  branch: string;
  entry: string;
  deploy: string;
  by: string;
  at: string;
};

/** A title as people type it, tidied; null when there is nothing usable left. */
export function finishedTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 48);
  return title.length >= 2 ? title : null;
}
