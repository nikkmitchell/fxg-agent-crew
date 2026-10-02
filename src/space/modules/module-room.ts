import type { ClientMessage, ServerMessage } from "../../../shared/space-wire";
import type { ModuleRoom } from "./run-module";

/**
 * THE `room` A THING FROM A SPACE GETS (run-module.ts): the same shape as the
 * kit's room in a space's own page (src/kit/connect.ts), so code written for
 * one runs in the other: room.emit/on("event") for moments, room.set/state/
 * on("state") for shared values, room.you.
 *
 * Here it is one item's copies in this saha.ing room, over the room's own
 * socket (moduleEvent / moduleState): two drum kits in a room are two sets of
 * drums. A moment goes to everyone else, as in the kit (the sender has
 * already played it); a value changes here at once and then everywhere.
 */
export function moduleRoom(options: {
  item: string;
  you: { id: string; name: string } | null;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  state?: Record<string, unknown>;
}): ModuleRoom & { close(): void } {
  const state: Record<string, unknown> = { ...(options.state ?? {}) };
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const fire = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[${options.item}] ${event} listener`, error);
      }
    }
  };
  const unsubscribe = options.subscribe((message) => {
    if (message.type === "moduleEvent" && message.item === options.item) fire("event", message.name, message.data, message.from);
    if (message.type === "moduleState" && message.item === options.item) {
      if (message.value === null) delete state[message.key];
      else state[message.key] = message.value;
      fire("state", message.key, message.value, message.by);
    }
  });
  const room: ModuleRoom & { close(): void } = {
    you: options.you,
    get state() {
      return state;
    },
    set(key, value) {
      const v = value === undefined ? null : value;
      if (v === null) delete state[key];
      else state[key] = v;
      options.send({ type: "moduleState", item: options.item, key, value: v });
      fire("state", key, v, options.you?.id ?? null);
    },
    emit(name, data) {
      options.send({ type: "moduleEvent", item: options.item, name, data: data === undefined ? null : data });
    },
    on(event, listener) {
      if (event === "ready") {
        // Already connected: the room's socket is open before a thing starts.
        queueMicrotask(() => (listener as (room: unknown) => void)(room));
        return () => undefined;
      }
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (...args: unknown[]) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (...args: unknown[]) => void);
    },
    people: new Map(),
    others: () => [],
    ready: true,
    connected: true,
    guest: false,
    close: () => {
      unsubscribe();
      listeners.clear();
    },
  };
  return room;
}
