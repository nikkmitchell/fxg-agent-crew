import { roomKey } from "../../shared/space-room.js";

/**
 * THE SHARED VALUES OF THINGS FROM SPACES, per room and per item
 * (shared/room-items.ts, ModuleRoomItem): what a drum kit, a garden or a
 * game has decided that everybody standing round it should see alike. A copy
 * that starts reads them here; changes reach the room's other copies over the
 * room socket (moduleState).
 *
 * In memory, for now: a restart starts every thing fresh, the way a page
 * reload does on the thing's own site. Each item keeps a bounded amount.
 */
export const MODULE_STATE_LIMITS = { keys: 200, bytes: 256 * 1024 } as const;

export class ModuleStates {
  private readonly rooms = new Map<string, Map<string, Map<string, { value: unknown; bytes: number }>>>();

  /** Everything an item keeps now. */
  get(room: string, item: string): Record<string, unknown> {
    const values = this.rooms.get(roomKey(room))?.get(item);
    return values ? Object.fromEntries([...values].map(([key, entry]) => [key, entry.value])) : {};
  }

  /** Keep a value (null removes it). False when the item is already full. */
  set(room: string, item: string, key: string, value: unknown): boolean {
    const roomItems = this.rooms.get(roomKey(room)) ?? new Map<string, Map<string, { value: unknown; bytes: number }>>();
    const values = roomItems.get(item) ?? new Map<string, { value: unknown; bytes: number }>();
    if (value === null) {
      values.delete(key);
    } else {
      const bytes = JSON.stringify(value).length;
      const total = [...values.values()].reduce((sum, entry) => sum + entry.bytes, 0) - (values.get(key)?.bytes ?? 0) + bytes;
      if ((!values.has(key) && values.size >= MODULE_STATE_LIMITS.keys) || total > MODULE_STATE_LIMITS.bytes) return false;
      values.set(key, { value, bytes });
    }
    roomItems.set(item, values);
    this.rooms.set(roomKey(room), roomItems);
    return true;
  }

  /** An item left the room: its values go with it, and its parts' (<item>/<key>). */
  forget(room: string, item: string): void {
    const items = this.rooms.get(roomKey(room));
    if (!items) return;
    for (const key of [...items.keys()]) if (key === item || key.startsWith(`${item}/`)) items.delete(key);
  }
}
