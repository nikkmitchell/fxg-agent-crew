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

/**
 * Its room's name, from the title: WebHarness names a room with letters, digits and _ . - only, so
 * "Plaza at dusk" is the room "plaza-at-dusk" (the title is what people read). Null if nothing is left.
 */
export function finishedRoomName(title: string): string | null {
  const name = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return name.length >= 2 ? name : null;
}
