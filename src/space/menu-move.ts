/**
 * WHERE YOUR SETTINGS MENU SITS (Nikk, 5903): "beside the X button, also add a
 * little move button, and if you grab that, then you can move your own
 * settings around to place it in a different position."
 *
 * The menu opens in front of you, inside the controls that travel with you.
 * Moving it keeps an OFFSET from that place, in the controls' own frame, so a
 * menu you put down to your left stays to your left as you walk and turn.
 * It is yours alone: kept in this browser, never sent to the room.
 */

export type MenuOffset = { x: number; y: number; z: number };

export const NO_OFFSET: MenuOffset = { x: 0, y: 0, z: 0 };

/** Far enough to put it beside you or down by your waist; not so far it is lost. */
export const MENU_REACH = { x: 1.2, y: 0.9, z: 0.6 } as const;

const KEY = "settings-menu-offset";

export function clampOffset(offset: MenuOffset): MenuOffset {
  const within = (value: number, limit: number) => (Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0);
  return { x: within(offset.x, MENU_REACH.x), y: within(offset.y, MENU_REACH.y), z: within(offset.z, MENU_REACH.z) };
}

/** Where the menu was last put, or no offset for a first open, a private window or a bad value. */
export function loadOffset(storage: Pick<Storage, "getItem"> | null = safeStorage()): MenuOffset {
  try {
    const kept = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<MenuOffset> | null;
    if (!kept || typeof kept !== "object") return NO_OFFSET;
    return clampOffset({ x: Number(kept.x), y: Number(kept.y), z: Number(kept.z) });
  } catch {
    return NO_OFFSET;
  }
}

export function saveOffset(offset: MenuOffset, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(clampOffset(offset)));
  } catch {
    /* per-viewer only; a browser that will not keep it just forgets */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
