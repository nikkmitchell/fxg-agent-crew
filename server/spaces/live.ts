import { randomBytes } from "node:crypto";
import { KIT_LIMITS, bytesOf, colorFor, readClientMessage, type KitPerson, type ServerMessage } from "../../shared/space-kit.js";
import type { SpaceStore } from "./store.js";
import type { TicketHolder } from "./tickets.js";

/**
 * WHO IS IN EACH SPACE, LIVE (shared/space-kit.ts). One hub for every space:
 * a page joins with a ticket (a person) or without (a guest who watches),
 * sends its pose, and gets everyone's poses back ten times a second while
 * anything moves. Shared values are kept in the database so a space
 * remembers them; poses are not kept at all.
 *
 * Guests can see and hear everything and change nothing: no pose, no value,
 * no line. That is what lets a public space be opened by anybody without
 * letting anybody write in it.
 */

export type LiveSocket = { send(text: string): void; close(code?: number, reason?: string): void };

type Member = {
  socket: LiveSocket;
  /** The page it came from (the kit makes one per page), so a reconnect replaces rather than adds. */
  page: string | null;
  renewing: NodeJS.Timeout | null;
  person: KitPerson | null;
  /**
   * UNSEEN: a page that hosts this space's live pieces somewhere else (the
   * saha.ing room of the same name, src/space/LivePiece.tsx). It shares and
   * hears the space's values and moments as its person, so a piece has one
   * state wherever it runs, but it is nobody standing IN the space: never
   * drawn, never counted, no pose.
   */
  unseen: boolean;
  poses: number[];
  writes: number[];
  events: number[];
};

type Room = { members: Set<Member>; dirty: boolean; quietSince: number };

/** How often the server asks each space socket whether it is still there. */
export const HEARTBEAT_MS = 30_000;

type Pingable = { ping(): void; terminate(): void; on(event: "pong", listener: () => void): unknown };

/**
 * A SEAT WHOSE PAGE HAS GONE, GONE. A tab closed on a sleeping laptop, or a
 * network that dropped, never sends a close, so its seat stayed: two hours
 * after Mica closed three tabs, xr.instruments still counted "3 here", all
 * baiwei2, all standing where they arrived. Every HEARTBEAT_MS the socket is
 * pinged (browsers answer on their own); one that has not answered the
 * previous ping is ended, and its seat leaves with it. Returns the stop.
 */
export function keepAlive(socket: Pingable, everyMs = HEARTBEAT_MS): () => void {
  let answered = true;
  socket.on("pong", () => {
    answered = true;
  });
  const timer = setInterval(() => {
    if (!answered) {
      clearInterval(timer);
      socket.terminate();
      return;
    }
    answered = false;
    try {
      socket.ping();
    } catch {
      clearInterval(timer);
      socket.terminate();
    }
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** How often a person in a space gets a fresh ticket: well inside KIT_LIMITS.ticketMs. */
export const RENEW_MS = 10 * 60_000;

export class SpaceLive {
  private readonly rooms = new Map<string, Room>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: SpaceStore,
    private readonly bodyUrl: (body: string, space: string) => string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.tick(), 1000 / KIT_LIMITS.broadcastHz);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** How many people (not guests) are in a space right now. */
  count(space: string): number {
    return [...(this.rooms.get(space)?.members ?? [])].filter((member) => member.person && !member.unseen).length;
  }

  /**
   * `page`: the kit's id for this page. THE SAME PAGE COMING BACK replaces its
   * old seat instead of taking another (Mica, 6319: two tabs showed "6 here",
   * because every reconnect added name~2, ~3 while old sockets lingered). A
   * second tab or device has its own page id, so it is still a second figure.
   *
   * `renew`: makes a fresh ticket for this person; sent every RENEW_MS so a
   * visit outlives its first ticket, and a restart reconnects as you.
   */
  join(space: string, socket: LiveSocket, holder: TicketHolder | null, options: { page?: string | null; renew?: () => string; unseen?: boolean } = {}): { receive: (text: string) => void; leave: () => void } {
    const room = this.rooms.get(space) ?? { members: new Set<Member>(), dirty: false, quietSince: this.now() };
    this.rooms.set(space, room);
    const page = options.page && /^[A-Za-z0-9_-]{8,64}$/.test(options.page) ? options.page : null;
    let reuse: string | null = null;
    if (holder && page) {
      for (const old of room.members) {
        if (old.page !== page || old.person?.name !== holder.username) continue;
        reuse = old.person.id;
        this.drop(space, room, old);
        try {
          old.socket.close(4000, "replaced by the same page");
        } catch {
          // Already gone.
        }
      }
    }
    // Dropping the page's old seat may have emptied, and so forgotten, the room.
    this.rooms.set(space, room);
    let person: KitPerson | null = null;
    if (holder) {
      // A SECOND DEVICE (or tab) OF THE SAME PERSON IS A SECOND FIGURE, named
      // the same (Nikk, 6173: "it should show multiple if you join on multiple
      // devices ... instead you should have doubled avatar"), rather than one
      // figure flipping between two places.
      const taken = new Set([...room.members].map((member) => member.person?.id));
      let id = reuse ?? holder.username;
      for (let n = 2; taken.has(id); n += 1) id = `${holder.username}~${n}`;
      person = {
        id,
        name: holder.username,
        body: holder.body,
        bodyUrl: holder.body ? this.bodyUrl(holder.body, space) : null,
        color: colorFor(holder.username),
        p: null,
        q: null,
        hl: null,
        hr: null,
        voice: false,
      };
    }
    const unseen = options.unseen === true && person !== null;
    const member: Member = { socket, page, renewing: null, person, unseen, poses: [], writes: [], events: [] };
    if (person && options.renew) {
      const renew = options.renew;
      member.renewing = setInterval(() => this.send(member, { t: "ticket", ticket: renew() }), RENEW_MS);
      member.renewing.unref?.();
    }
    room.members.add(member);
    room.dirty = true;
    this.send(member, { t: "hello", you: person, guest: person === null, space, state: this.store.state(space), people: this.people(room) });
    if (person) this.send(member, { t: "items", items: this.store.items(person.name) });

    return {
      receive: (text) => this.receive(space, room, member, text),
      leave: () => this.drop(space, room, member),
    };
  }

  /**
   * LEAVE EVERY SPACE (Baiwei, 6395: "Can you kick my presence out of that
   * room?"). Every seat this person holds, in every space, on every device,
   * is closed with 4001, which the kit takes as "do not come back on your
   * own". Returns how many seats went.
   */
  leaveEverywhere(username: string): number {
    const who = username.toLowerCase();
    let left = 0;
    for (const [space, room] of [...this.rooms]) {
      for (const member of [...room.members]) {
        if (member.person?.name.toLowerCase() !== who) continue;
        this.drop(space, room, member);
        left += 1;
        try {
          member.socket.close(4001, "left every space from saha.ing");
        } catch {
          // Already gone.
        }
      }
    }
    return left;
  }

  private drop(space: string, room: Room, member: Member): void {
    if (member.renewing) clearInterval(member.renewing);
    member.renewing = null;
    room.members.delete(member);
    room.dirty = true;
    if (room.members.size === 0 && this.rooms.get(space) === room) this.rooms.delete(space);
  }

  private receive(space: string, room: Room, member: Member, text: string): void {
    if (text.length > 16_384) return;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const message = readClientMessage(raw);
    if (!message) return;
    if (!member.person) {
      this.send(member, { t: "refused", why: "You are watching as a guest. Enter this space from saha.ing to be seen and to change things." });
      return;
    }
    const at = this.now();
    if (member.unseen && (message.t === "pose" || message.t === "voice" || message.t === "signal" || message.t === "say")) return;
    if (message.t === "pose") {
      member.poses = member.poses.filter((when) => at - when < 1000);
      if (member.poses.length >= KIT_LIMITS.posesPerSecond) return;
      member.poses.push(at);
      member.person.p = message.p;
      member.person.q = message.q;
      member.person.hl = message.hl ?? null;
      member.person.hr = message.hr ?? null;
      room.dirty = true;
      return;
    }
    if (message.t === "voice") {
      member.person.voice = message.on;
      room.dirty = true;
      return;
    }
    if (message.t === "emit") {
      member.events = member.events.filter((when) => at - when < 1000);
      if (member.events.length >= KIT_LIMITS.eventsPerSecond) return;
      member.events.push(at);
      // To everyone else: the sender already played it.
      const text = JSON.stringify({ t: "event", from: member.person.id, name: message.name, data: message.data } satisfies ServerMessage);
      for (const other of room.members) {
        if (other === member) continue;
        try {
          other.socket.send(text);
        } catch {
          /* closing */
        }
      }
      return;
    }
    if (message.t === "signal") {
      // Passed to the one person it is for, never to anyone else; not kept.
      const text = JSON.stringify({ t: "signal", from: member.person.id, s: message.s } satisfies ServerMessage);
      for (const other of room.members) {
        if (other.person?.id !== message.to) continue;
        try {
          other.socket.send(text);
        } catch {
          /* closing */
        }
      }
      return;
    }
    member.writes = member.writes.filter((when) => at - when < 1000);
    if (member.writes.length >= KIT_LIMITS.setsPerSecond) {
      this.send(member, { t: "refused", why: "Too many changes at once; slow down." });
      return;
    }
    member.writes.push(at);
    if (message.t === "give" || message.t === "drop") {
      const username = member.person.name;
      if (message.t === "give") {
        if (this.store.itemCount(username) >= KIT_LIMITS.itemsPerPerson) {
          this.send(member, { t: "refused", why: `You already carry ${KIT_LIMITS.itemsPerPerson} things; a space must take one back first.` });
          return;
        }
        this.store.addItem(username, { id: randomBytes(9).toString("base64url"), name: message.name, from: space, url: message.url, data: message.data, at: new Date(at).toISOString() });
      } else if (!this.store.removeItem(username, message.id, space)) {
        this.send(member, { t: "refused", why: "A space can only take back what it gave." });
        return;
      }
      // Every device of this person, in every space, sees the change.
      const items = this.store.items(username);
      for (const each of this.rooms.values()) for (const other of each.members) if (other.person?.name === username) this.send(other, { t: "items", items });
      return;
    }
    if (message.t === "say") {
      this.broadcast(room, { t: "say", id: member.person.id, name: member.person.name, text: message.text, at });
      return;
    }
    // set
    const size = this.store.stateSize(space);
    const old = this.store.stateValueBytes(space, message.k);
    const next = message.v === null ? 0 : bytesOf(message.v);
    if (old === 0 && next > 0 && size.keys >= KIT_LIMITS.keys) {
      this.send(member, { t: "refused", why: `This space already keeps ${KIT_LIMITS.keys} values; remove one first.` });
      return;
    }
    if (size.bytes - old + next > KIT_LIMITS.totalBytes) {
      this.send(member, { t: "refused", why: "This space's shared values are full." });
      return;
    }
    this.store.setState(space, message.k, message.v, member.person.name, new Date(at).toISOString());
    this.broadcast(room, { t: "set", k: message.k, v: message.v, by: member.person.name });
  }

  private people(room: Room): KitPerson[] {
    return [...room.members].flatMap((member) => (member.person && !member.unseen ? [member.person] : []));
  }

  private tick(): void {
    const at = this.now();
    for (const room of this.rooms.values()) {
      // Twenty seconds of stillness still gets a snapshot, so a proxy never
      // mistakes a calm room for a dead connection.
      if (!room.dirty && at - room.quietSince < 20_000) continue;
      room.dirty = false;
      room.quietSince = at;
      this.broadcast(room, { t: "people", people: this.people(room) });
    }
  }

  private broadcast(room: Room, message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const member of room.members) {
      try {
        member.socket.send(text);
      } catch {
        /* a closing socket; its leave() is on the way */
      }
    }
  }

  private send(member: Member, message: ServerMessage): void {
    try {
      member.socket.send(JSON.stringify(message));
    } catch {
      /* closing */
    }
  }
}
