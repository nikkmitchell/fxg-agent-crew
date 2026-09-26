export type GoGuideStorage = Pick<Storage, "getItem" | "setItem">;

const PREFIX = "saha.go-guide.seen.v1:";

function keyFor(actorId: string | null): string | null {
  const actor = actorId?.trim().toLocaleLowerCase("en-US");
  return actor ? `${PREFIX}${actor}` : null;
}

/** Whether this player has dismissed the first-game guide in this browser. */
export function hasSeenGoGuide(actorId: string | null, storage: GoGuideStorage | null): boolean {
  const key = keyFor(actorId);
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === "seen";
  } catch {
    return false;
  }
}

/** Remember the choice per player without putting it in shared room state. */
export function rememberGoGuide(actorId: string | null, storage: GoGuideStorage | null): void {
  const key = keyFor(actorId);
  if (!key || !storage) return;
  try {
    storage.setItem(key, "seen");
  } catch {
    // A private or restricted browser still gets the guide for this visit.
  }
}
