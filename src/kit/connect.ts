import type { KitPerson, KitSignal, ServerMessage } from "../../shared/space-kit";

/**
 * THE CONNECTION, for any page, three.js or not (shared/space-kit.ts has the
 * wire). A space page is sandboxed, so who you are comes from the ticket
 * saha.ing put in the #fragment when you entered from saha.ing; without one
 * you watch as a guest.
 */

const RECONNECT_MS = [1000, 2000, 4000, 8000, 15000];

export type Vec3 = [number, number, number];
export type Quat4 = [number, number, number, number];

type Listener = (...args: never[]) => void;

export type SahaRoom = {
  space: string;
  /** The ticket this page entered with (null for a guest): for the kit's own requests. */
  ticket: string | null;
  /** You, as others see you; null while connecting and for guests. */
  you: KitPerson | null;
  /** True when watching without a ticket. */
  guest: boolean;
  connected: boolean;
  /** Everyone in the space (you included), by id. */
  people: Map<string, KitPerson>;
  /** The shared values, as every visitor sees them. */
  state: Record<string, unknown>;
  on(event: "ready", listener: (room: SahaRoom) => void): () => void;
  on(event: "people", listener: (people: KitPerson[]) => void): () => void;
  on(event: "join" | "leave", listener: (person: KitPerson) => void): () => void;
  on(event: "state", listener: (key: string, value: unknown, by: string) => void): () => void;
  on(event: "say", listener: (message: { id: string; name: string; text: string; at: number }) => void): () => void;
  on(event: "refused", listener: (why: string) => void): () => void;
  on(event: "connection", listener: (connected: boolean) => void): () => void;
  on(event: "signal", listener: (from: string, signal: KitSignal) => void): () => void;
  /** For the kit's own parts (voice): any message the wire takes. */
  send(message: unknown): void;
  /** Everyone but you. */
  others(): KitPerson[];
  /** Where you are: p [x,y,z] metres, q [x,y,z,w]; hands optional. */
  pose(p: Vec3, q: Quat4, hl?: Vec3 | null, hr?: Vec3 | null): void;
  /** Set a shared value everyone sees (null removes it). JSON, up to 4 KB. */
  set(key: string, value: unknown): void;
  /** A short line, shown over your head to everyone. */
  say(text: string): void;
  leave(): void;
};

export type ConnectOptions = {
  href?: string;
  server?: string;
  space?: string;
  ticket?: string | null;
  WebSocket?: typeof WebSocket;
};

/** The ticket saha.ing put in the #fragment, then taken out of the address bar. */
export function takeTicket(href: string): string | null {
  const url = new URL(href);
  const match = /(?:^#|&)saha=([^&]+)/.exec(url.hash);
  if (!match) return null;
  const ticket = decodeURIComponent(match[1]);
  try {
    // Out of the address bar, so it is not copied into a link and shared.
    const rest = url.hash.replace(/(^#|&)saha=[^&]+/, "$1").replace(/^#&?$/, "");
    history.replaceState(history.state, "", url.pathname + url.search + rest);
  } catch {
    /* a sandboxed page may not rewrite its URL; the ticket still works */
  }
  return ticket;
}

export function connectSaha(options: ConnectOptions = {}): SahaRoom {
  const href = options.href ?? (typeof location !== "undefined" ? location.href : "");
  const page = new URL(href);
  const server = (options.server ?? page.origin).replace(/\/$/, "");
  const space = options.space ?? (/^\/s\/([^/]+)/.exec(page.pathname) ?? [])[1];
  if (!space) throw new Error("saha.js: not inside a space (/s/<space>/); pass { space }");
  const ticket = options.ticket !== undefined ? options.ticket : typeof location !== "undefined" ? takeTicket(href) : null;
  const Socket = options.WebSocket ?? globalThis.WebSocket;

  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      try {
        (listener as (...values: unknown[]) => void)(...args);
      } catch (error) {
        console.error("saha.js listener", error);
      }
    }
  };

  let socket: WebSocket | null = null;
  let attempt = 0;
  let left = false;

  const send = (message: unknown) => {
    if (room.guest || !socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  };

  const room: SahaRoom = {
    space,
    ticket,
    you: null,
    guest: ticket === null,
    connected: false,
    people: new Map(),
    state: {},
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    others() {
      return [...room.people.values()].filter((person) => person.id !== room.you?.id);
    },
    pose(p, q, hl = null, hr = null) {
      send({ t: "pose", p, q, hl, hr });
    },
    set(key, value) {
      send({ t: "set", k: key, v: value === undefined ? null : value });
    },
    say(text) {
      send({ t: "say", text: String(text) });
    },
    send(message: unknown) {
      send(message);
    },
    leave() {
      left = true;
      socket?.close();
    },
  } as SahaRoom;

  const setPeople = (list: KitPerson[]) => {
    const seen = new Set<string>();
    for (const person of list) {
      seen.add(person.id);
      const had = room.people.has(person.id);
      room.people.set(person.id, person);
      if (!had) emit("join", person);
    }
    for (const [id, person] of room.people) {
      if (!seen.has(id)) {
        room.people.delete(id);
        emit("leave", person);
      }
    }
    emit("people", [...room.people.values()]);
  };

  const connect = () => {
    if (left) return;
    const url = `${server.replace(/^http/, "ws")}/bff/spaces/${encodeURIComponent(space)}/live${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`;
    const current = new Socket(url);
    socket = current;
    current.onopen = () => {
      attempt = 0;
    };
    current.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === "hello") {
        room.you = message.you;
        room.guest = message.guest;
        room.state = message.state ?? {};
        room.connected = true;
        setPeople(message.people ?? []);
        emit("ready", room);
        emit("connection", true);
      } else if (message.t === "people") {
        setPeople(message.people ?? []);
      } else if (message.t === "set") {
        if (message.v === null) delete room.state[message.k];
        else room.state[message.k] = message.v;
        emit("state", message.k, message.v, message.by);
      } else if (message.t === "say") {
        emit("say", message);
      } else if (message.t === "refused") {
        emit("refused", message.why);
      } else if (message.t === "signal") {
        emit("signal", message.from, message.s);
      }
    };
    current.onclose = (event) => {
      const was = room.connected;
      room.connected = false;
      if (was) emit("connection", false);
      // 4403/4404: not public, or no such space. Trying again will not help.
      if (left || event.code === 4403 || event.code === 4404) return;
      setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
    };
    current.onerror = () => undefined;
  };

  connect();
  return room;
}
