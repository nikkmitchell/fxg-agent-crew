import type { FastifyInstance } from "fastify";
// The socket type comes from the plugin rather than from `ws` directly: `ws`
// is the plugin's dependency, not ours, and importing it here would be reaching
// past pnpm's isolation into a package we never declared.
import type { WebSocket } from "@fastify/websocket";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { spaceRoomOf } from "../require-session.js";
import { NOT_A_PERSON, actorKey } from "../../shared/space-layout.js";
import { isRoomName, roomKey } from "../../shared/space-room.js";
import { WebharnessClient } from "../webharness/client.js";
import { classify } from "../webharness/errors.js";
import type { Placement, Showing } from "../../shared/space-wire.js";
import type { RoomItem } from "../../shared/room-items.js";
import { parseClientMessage, type ServerMessage, type WirePerson } from "../../shared/space-wire.js";
import { Stillness } from "../../shared/stillness.js";
import { isWalking, Presence, STALE_AFTER_MS } from "./presence.js";
import { touchAgent, type Touches } from "./touch.js";

/**
 * The socket the room is drawn from.
 *
 * Authenticated by the SAME session cookie as every other route — a WebSocket
 * handshake is an HTTP request and carries cookies, so there is no second auth
 * path to get wrong here. A socket with no valid session is closed with a
 * reason rather than left open in a degraded state: an unauthenticated viewer
 * would be watching real people move around a real room.
 *
 * Read-only. Nothing sent over this socket writes to the board. The only state
 * a client can change is where its own avatar is standing, which lives in
 * memory and is forgotten on restart.
 */

/** How often positions are advanced and sent. 10/s is smooth enough to walk. */
const TICK_MS = 100;

export class SpaceHub {
  readonly presence: Presence;
  /** Sockets per actor. More than one is a second tab, not a second person. */
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly socketRooms = new Map<WebSocket, string>();
  private readonly socketActors = new Map<WebSocket, string>();
  private readonly socketSessions = new Map<WebSocket, string>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * Which body each actor has chosen, read fresh on every snapshot.
   *
   * READ, NOT CAPTURED, for the same reason the panel stands are: somebody who
   * changes their body ten seconds from now must appear in the next tick, not
   * at the next restart. It is one indexed lookup per person per tick against
   * a table with a handful of rows.
   *
   * DEFAULTS TO KNOWING NOTHING so every test that builds a bare hub keeps
   * working, and so a hub with no database says "nobody has chosen" rather
   * than inventing a body.
   */
  constructor(
    presence = new Presence(),
    private readonly bodyOf: (actorId: string) => string | null = () => null,
    private readonly now: () => number = Date.now,
  ) {
    this.presence = presence;
  }

  /** How long each person has looked the same. See shared/stillness.ts. */
  private readonly stillness = new Stillness();

  attach(actorId: string, kind: "human" | "agent" | null, socket: WebSocket, room = "saha.ing", sid?: string): void {
    const key = actorKey(actorId);
    const existing = this.sockets.get(key);
    if (existing) existing.add(socket);
    else this.sockets.set(key, new Set([socket]));
    this.socketRooms.set(socket, roomKey(room));
    this.socketActors.set(socket, actorId);
    if (sid) this.socketSessions.set(socket, sid);
    this.presence.join(actorId, kind, true);
    this.start();
  }

  detach(actorId: string, socket: WebSocket): void {
    this.socketRooms.delete(socket);
    this.socketActors.delete(socket);
    this.socketSessions.delete(socket);
    const key = actorKey(actorId);
    const sockets = this.sockets.get(key);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size > 0) return;
    // The last tab closed. Now they have actually left.
    this.sockets.delete(key);
    // AND THEIR MICROPHONE IS NOT ON ANY MORE, whatever they last said about
    // it. A name left in this set is somebody every newcomer tries to call and
    // nobody ever reaches. Announced as well as removed, so people already in
    // the room tear down the connection rather than waiting on silence.
    if (this.voices.delete(key)) {
      this.broadcast({
        type: "voicePresence",
        actorId: this.presence.find(key)?.actorId ?? actorId,
        on: false,
      });
    }
    this.presence.leave(actorId);
    if (this.sockets.size === 0) this.stop();
  }

  /** A room switch ends only that session's old sockets, not other devices. */
  evictSession(sid: string): void {
    for (const [socket, socketSid] of [...this.socketSessions]) {
      if (socketSid !== sid) continue;
      const actorId = this.socketActors.get(socket);
      if (!actorId) continue;
      this.detach(actorId, socket);
      try { socket.close(1000, "entered another room"); } catch { /* already closed */ }
    }
  }

  /** Sockets outlive HTTP requests. Recheck their sessions periodically so a
   * signed-out or expired cookie cannot keep receiving private-room snapshots. */
  evictInvalidSessions(valid: (sid: string, room: string) => boolean): number {
    const invalid = new Set<string>();
    for (const [socket, sid] of this.socketSessions) {
      const room = this.socketRooms.get(socket);
      if (!room || !valid(sid, room)) invalid.add(sid);
    }
    for (const sid of invalid) this.evictSession(sid);
    return invalid.size;
  }

  has(socket: WebSocket): boolean {
    return this.socketRooms.has(socket);
  }

  /**
   * Everyone the browser should draw, in wire shape.
   *
   * Every call observes stillness, and that is safe to do from the tick, the
   * presence route and an arrival alike: looking at somebody who has not
   * changed changes nothing, so no caller can make anybody look more or less
   * still than they are.
   */
  snapshot(): WirePerson[] {
    const people = this.presence
      .everyone()
      .filter((occupant) => !NOT_A_PERSON.has(occupant.actorId))
      .map((occupant) => ({
        actorId: occupant.actorId,
        kind: occupant.kind,
        at: occupant.at,
        moving: isWalking(occupant),
        facing: occupant.facing,
        because: occupant.because,
        following: occupant.following?.actorId ?? null,
        waypointsLeft: occupant.walking?.waypoints.length ?? 0,
        connected: occupant.connected,
        head: occupant.head,
        standing: occupant.standing,
        hands: occupant.hands,
        attending: occupant.attending ? { utteranceId: occupant.attending.utteranceId } : null,
        avatar: occupant.avatar,
        body: this.bodyOf(occupant.actorId),
      }));
    const stillFor = this.stillness.observe(people, this.now());
    return people.map((person) => ({ ...person, stillForMs: stillFor.get(person.actorId) ?? 0 }));
  }

  send(socket: WebSocket, message: ServerMessage): void {
    // OPEN is 1. Writing to a closing socket throws, and one dead client must
    // not take down the broadcast for everyone else.
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Nothing useful to do: the close handler will clean it up.
    }
  }

  /**
   * Hand a message to one person's sockets, if they have any.
   *
   * Returns whether anybody was there. All of them, not one: somebody signed in
   * on a desktop and a headset at once is one person in two places, and a call
   * offered only to whichever socket happened to be first would be answered by
   * the wrong device about half the time.
   */
  /**
   * Who has their microphone open.
   *
   * Held here rather than in `Presence` because it is not a fact about where
   * anybody is, and because it must vanish the moment a socket does — a name
   * left in this set is somebody the room keeps trying to call.
   */
  readonly voices = new Set<string>();

  deliver(actorId: string, message: ServerMessage): boolean {
    const sockets = this.sockets.get(actorKey(actorId));
    if (!sockets || sockets.size === 0) return false;
    for (const socket of sockets) this.send(socket, message);
    return true;
  }

  broadcast(message: ServerMessage): void {
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) this.send(socket, message);
    }
  }

  /** Broadcast shared state only inside the room that owns it. */
  broadcastRoom(room: string, message: ServerMessage): void {
    const wanted = roomKey(room);
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) if (this.socketRooms.get(socket) === wanted) this.send(socket, message);
    }
  }

  /**
   * The loop runs only while someone is watching.
   *
   * An empty room needs no physics, and a timer ticking ten times a second in
   * an idle process is the kind of thing that shows up later as unexplained CPU.
   */
  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Never hold the process open. A test that forgets to close is a test that
    // hangs, and a hanging test suite gets skipped rather than fixed.
    this.timer.unref?.();
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    this.presence.tick(TICK_MS / 1000);
    for (const actorId of this.presence.prune()) {
      // Pruned for silence: close whatever sockets are still nominally attached
      // so the client learns it has been dropped instead of watching a frozen
      // room.
      for (const socket of this.sockets.get(actorKey(actorId)) ?? []) {
        this.send(socket, {
          type: "refused",
          reason: `no messages for ${Math.round(STALE_AFTER_MS / 1000)} seconds — reconnecting`,
        });
        try {
          socket.close(1000);
        } catch {
          // Already gone.
        }
        this.socketRooms.delete(socket);
        this.socketActors.delete(socket);
        this.socketSessions.delete(socket);
      }
      this.sockets.delete(actorKey(actorId));
      if (this.voices.delete(actorKey(actorId))) {
        this.broadcast({ type: "voicePresence", actorId, on: false });
      }
    }
    if (this.sockets.size === 0) {
      this.stop();
      return;
    }
    this.broadcast({ type: "snapshot", now: Date.now(), people: this.snapshot() });
  }

  close(): void {
    this.stop();
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) {
        try {
          socket.close(1001);
        } catch {
          // Already gone.
        }
      }
    }
    this.sockets.clear();
    this.socketRooms.clear();
    this.socketActors.clear();
    this.socketSessions.clear();
    this.voices.clear();
  }

  /** People with at least one socket open. Not the number of sockets. */
  get connectedActors(): number {
    return this.sockets.size;
  }

  /** Sockets, tabs included. Distinct from `connectedActors` on purpose. */
  get connectedSockets(): number {
    let total = 0;
    for (const sockets of this.sockets.values()) total += sockets.size;
    return total;
  }
}

export function registerSpaceRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  hub: SpaceHub,
  /**
   * Where the panels currently hang, read at the moment somebody arrives.
   *
   * Passed in rather than imported so this file keeps knowing nothing about the
   * database — the socket's job is who is here and where they are.
   */
  panelsNow: (room: string) => Placement[],
  /**
   * What the room is showing, read on arrival for the same reason as the
   * panels: it changes rarely, and repeating it in every snapshot is traffic
   * that looks free until the room is full.
   */
  showingNow: (room: string) => Showing,
  itemsNow: (room: string) => RoomItem[],
  /** Touches and agents' feelings about them. Optional so older tests run unchanged. */
  touches: Touches | null = null,
  hubFor: (room: string) => SpaceHub = () => hub,
): void {
  app.get("/bff/space/room", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
    }
    return reply.header("cache-control", "no-store").send({ roomName: spaceRoomOf(session) });
  });

  /**
   * WHO IS IN THE ROOM, AND WHERE, in one read.
   *
   * WHY IT EXISTS. Everything an agent needed to know about the room only
   * existed on the socket, so answering "come and stand where my hand is"
   * meant opening a WebSocket, waiting for a snapshot and closing it again —
   * which every agent had to write for itself, and which counts as joining
   * the room in order to look at it. Nikk asks for that placement often.
   *
   * THE SAME DATA THE SOCKET BROADCASTS, and nothing more: it is already sent
   * to everyone standing in the room. No cache, because a position seconds old
   * is a position somewhere else.
   */
  app.get("/bff/space/presence", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
    }
    return reply.header("cache-control", "no-store").send({ now: Date.now(), people: hubFor(spaceRoomOf(session)).snapshot() });
  });

  app.get("/bff/space/socket", { websocket: true }, (socket, request) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      // Say why, then close. A silent close is indistinguishable from a proxy
      // problem, and this exact confusion has cost a day before.
      hub.send(socket, { type: "refused", reason: "not signed in" });
      socket.close(1008, "not signed in");
      return;
    }

    const actorId = session.username;
    if (NOT_A_PERSON.has(actorKey(actorId))) {
      hub.send(socket, { type: "refused", reason: `${actorId} is not a person` });
      socket.close(1008, "not a person");
      return;
    }

    const room = spaceRoomOf(session);
    const liveHub = hubFor(room);
    liveHub.attach(actorId, session.kind, socket, room, request.cookies[config.cookieName]);
    liveHub.send(socket, {
      type: "welcome",
      you: actorId,
      now: Date.now(),
      people: liveHub.snapshot(),
      // Once, on arrival. Panels move when somebody drags one, and repeating
      // four placements in every snapshot to say "still there" is traffic that
      // looks free until there are twenty people in the room.
      panels: panelsNow(room),
      showing: showingNow(room),
      items: itemsNow(room),
      // Who to call on arrival. Yourself excluded: a second tab of your own is
      // still you, and calling it would put your own microphone in your ears.
      voice: [...liveHub.voices]
        .filter((key) => key !== actorKey(actorId))
        .map((key) => liveHub.presence.find(key)?.actorId ?? key),
    });

    /** When each distinct note was last logged. See the "note" frame below. */
    const noteAt = new Map<string, number>();
    socket.on("message", (raw: Buffer | string) => {
      // A frame already queued when a room switch evicted this socket must not
      // write to the room it just left.
      if (!liveHub.has(socket)) return;
      const message = parseClientMessage(raw.toString());
      // A frame we cannot read is dropped. It is not evidence the socket is
      // bad, and disconnecting on it would make a single client bug look like
      // a server outage.
      if (!message) return;
      if (message.type === "ping") {
        liveHub.presence.heard(actorId);
        return;
      }
      if (message.type === "voicePresence") {
        // Told to the room, not asked of it: whether somebody's microphone is
        // on is theirs to state, and nobody else's to infer from silence.
        const key = actorKey(actorId);
        if (message.on) liveHub.voices.add(key);
        else liveHub.voices.delete(key);
        liveHub.broadcast({
          type: "voicePresence",
          actorId: liveHub.presence.find(key)?.actorId ?? actorId,
          on: message.on,
        });
        return;
      }
      if (message.type === "avatar") {
        // The actor id comes from the authenticated session, never the frame:
        // occupants may animate themselves and nobody else.
        liveHub.presence.animate(actorId, message);
        return;
      }
      if (message.type === "note") {
        /**
         * A headset cannot show anybody its console; this is how something only
         * the headset can see reaches whoever is reading the journal.
         *
         * THE THROTTLE IS PER SENTENCE, not per socket, and the difference cost
         * an evening. It used to drop EVERY note within two seconds of the last
         * one, whatever it said — so when Baiwei tapped the text box, "keyboard
         * opening" was logged and the line that came milliseconds after it was
         * silently thrown away. The journal showed the keyboard opening and then
         * nothing, which I read as evidence that nothing happened. It was
         * evidence that my own instrument had stopped.
         *
         * A repeated sentence is the thing worth suppressing: a per-frame note
         * flooding the log. A DIFFERENT sentence is never noise — it is the next
         * thing that happened, and at a moment like that it is the whole story.
         */
        const now = Date.now();
        const last = noteAt.get(message.note) ?? 0;
        if (now - last > 2_000) {
          noteAt.set(message.note, now);
          // Bounded: a client that invents a new sentence every frame must not
          // grow this for ever. Oldest first, which is insertion order here.
          if (noteAt.size > 64) noteAt.delete(noteAt.keys().next().value as string);
          request.log.info({ actorId, note: message.note }, "space client note");
        }
        return;
      }
      if (message.type === "touch") {
        // Who touched is the session, never the frame.
        if (touches) touchAgent(liveHub, touches, actorId, message.agentId, message.part, room);
        return;
      }
      if (message.type === "voice") {
        // RELAYED WITH THE SENDER STAMPED BY US. `from` is the session that
        // sent the frame, never a field the client supplied — a client that
        // could name its own sender could introduce itself to the room as
        // somebody else and be listened to as them.
        //
        // Refused to a stranger rather than dropped: an unanswered call and a
        // call that was never delivered look identical from the caller's side,
        // and only one of them is worth retrying.
        const from = liveHub.presence.find(actorId)?.actorId ?? actorId;
        if (!liveHub.deliver(message.to, { type: "voice", from, signal: message.signal })) {
          liveHub.send(socket, {
            type: "voicePresence",
            actorId: message.to,
            on: false,
          });
        }
        return;
      }
      liveHub.presence.moveSelf(actorId, message.at, message.facing, {
        // Spread deliberately: `head: undefined` when the client did not send
        // one leaves the last known head alone, while an explicit null clears
        // it. Only a client that mentions hands changes them.
        ...("head" in message ? { head: message.head ?? null } : {}),
        ...(message.hands ? { hands: message.hands } : {}),
      },
      // The sender's own measured height, when their device measures one.
      message.standing);
    });

    socket.on("close", () => liveHub.detach(actorId, socket));
    socket.on("error", () => liveHub.detach(actorId, socket));
  });
}

/** Entering a space is a privilege, not a client-side room-name selection. */
export function registerSpaceEntryRoute(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  client: WebharnessClient,
  evictSessionEverywhere: (sid: string) => void,
  afterSwitch: (actorId: string) => void = () => {},
): void {
  app.post<{ Body: { roomName?: unknown } }>("/bff/space/enter", async (request, reply) => {
    const sid = request.cookies[config.cookieName];
    const session = sessions.get(sid);
    if (!session || !sid) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
    }
    const asked = request.body?.roomName;
    if (!isRoomName(asked)) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "choose a valid room name" });
    }
    const wanted = roomKey(asked);
    try {
      // A public listing is not membership. Ask upstream for THIS token's joined
      // rooms on every entry, so a room one merely discovered cannot be entered.
      const joined = await client.rooms(session.token);
      if (!joined.some((room) => roomKey(room) === wanted)) {
        return reply.code(403).send({ code: "NOT_A_MEMBER", error: "join this room before entering its space" });
      }
    } catch (error) {
      const failure = classify(error);
      return reply.code(failure.status).send({
        code: failure.code,
        error: failure.detail,
        ...(failure.code === "SESSION_EXPIRED" ? { reauth: true } : {}),
      });
    }
    // The upstream check awaited the network. Another enter request for this
    // same sid may have completed while we waited, so the earlier `session`
    // object is not the current room (SQLite returns a detached row). A token
    // rotation also invalidates the membership check we just made.
    const latest = sessions.get(sid);
    if (!latest || latest.token !== session.token || actorKey(latest.username) !== actorKey(session.username)) {
      return reply.code(409).send({ code: "SESSION_CHANGED", error: "session changed while entering; retry" });
    }
    if (latest.spaceRoom !== wanted) {
      // Evict this sid from ALL hubs, not only the room the original request
      // saw. That closes a socket opened between two overlapping enter calls.
      if (spaceRoomOf(latest) !== wanted) evictSessionEverywhere(sid);
      sessions.enterRoom(sid, wanted);
      afterSwitch(latest.username);
    }
    return reply.send({ roomName: wanted });
  });
}

export { TICK_MS };
