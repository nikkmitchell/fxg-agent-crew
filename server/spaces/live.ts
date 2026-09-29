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
  person: KitPerson | null;
  poses: number[];
  writes: number[];
};

type Room = { members: Set<Member>; dirty: boolean; quietSince: number };

export class SpaceLive {
  private readonly rooms = new Map<string, Room>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: SpaceStore,
    private readonly bodyUrl: (body: string) => string | null,
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
    return [...(this.rooms.get(space)?.members ?? [])].filter((member) => member.person).length;
  }

  join(space: string, socket: LiveSocket, holder: TicketHolder | null): { receive: (text: string) => void; leave: () => void } {
    const room = this.rooms.get(space) ?? { members: new Set<Member>(), dirty: false, quietSince: this.now() };
    this.rooms.set(space, room);
    let person: KitPerson | null = null;
    if (holder) {
      // A SECOND DEVICE (or tab) OF THE SAME PERSON IS A SECOND FIGURE, named
      // the same (Nikk, 6173: "it should show multiple if you join on multiple
      // devices ... instead you should have doubled avatar"), rather than one
      // figure flipping between two places.
      const taken = new Set([...room.members].map((member) => member.person?.id));
      let id = holder.username;
      for (let n = 2; taken.has(id); n += 1) id = `${holder.username}~${n}`;
      person = {
        id,
        name: holder.username,
        body: holder.body,
        bodyUrl: holder.body ? this.bodyUrl(holder.body) : null,
        color: colorFor(holder.username),
        p: null,
        q: null,
        hl: null,
        hr: null,
      };
    }
    const member: Member = { socket, person, poses: [], writes: [] };
    room.members.add(member);
    room.dirty = true;
    this.send(member, { t: "hello", you: person, guest: person === null, space, state: this.store.state(space), people: this.people(room) });

    return {
      receive: (text) => this.receive(space, room, member, text),
      leave: () => {
        room.members.delete(member);
        room.dirty = true;
        if (room.members.size === 0) this.rooms.delete(space);
      },
    };
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
    member.writes = member.writes.filter((when) => at - when < 1000);
    if (member.writes.length >= KIT_LIMITS.setsPerSecond) {
      this.send(member, { t: "refused", why: "Too many changes at once; slow down." });
      return;
    }
    member.writes.push(at);
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
    return [...room.members].flatMap((member) => (member.person ? [member.person] : []));
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
