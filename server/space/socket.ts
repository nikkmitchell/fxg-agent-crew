import type { FastifyInstance } from "fastify";
// The socket type comes from the plugin rather than from `ws` directly: `ws`
// is the plugin's dependency, not ours, and importing it here would be reaching
// past pnpm's isolation into a package we never declared.
import type { WebSocket } from "@fastify/websocket";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { parseClientMessage, type ServerMessage, type WirePerson } from "../../shared/space-wire.js";
import { Presence, STALE_AFTER_MS } from "./presence.js";

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
  private timer: NodeJS.Timeout | null = null;

  constructor(presence = new Presence()) {
    this.presence = presence;
  }

  attach(actorId: string, kind: "human" | "agent" | null, socket: WebSocket): void {
    const existing = this.sockets.get(actorId);
    if (existing) existing.add(socket);
    else this.sockets.set(actorId, new Set([socket]));
    this.presence.join(actorId, kind, true);
    this.start();
  }

  detach(actorId: string, socket: WebSocket): void {
    const sockets = this.sockets.get(actorId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size > 0) return;
    // The last tab closed. Now they have actually left.
    this.sockets.delete(actorId);
    this.presence.leave(actorId);
    if (this.sockets.size === 0) this.stop();
  }

  /** Everyone the browser should draw, in wire shape. */
  snapshot(): WirePerson[] {
    return this.presence
      .everyone()
      .filter((occupant) => !NOT_A_PERSON.has(occupant.actorId))
      .map((occupant) => ({
        actorId: occupant.actorId,
        kind: occupant.kind,
        at: occupant.at,
        facing: occupant.facing,
        because: occupant.because,
        connected: occupant.connected,
        head: occupant.head,
        hands: occupant.hands,
      }));
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

  broadcast(message: ServerMessage): void {
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) this.send(socket, message);
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
      for (const socket of this.sockets.get(actorId) ?? []) {
        this.send(socket, {
          type: "refused",
          reason: `no messages for ${Math.round(STALE_AFTER_MS / 1000)} seconds — reconnecting`,
        });
        try {
          socket.close(1000);
        } catch {
          // Already gone.
        }
      }
      this.sockets.delete(actorId);
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
): void {
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
    if (NOT_A_PERSON.has(actorId)) {
      hub.send(socket, { type: "refused", reason: `${actorId} is not a person` });
      socket.close(1008, "not a person");
      return;
    }

    hub.attach(actorId, session.kind, socket);
    hub.send(socket, { type: "welcome", you: actorId, now: Date.now(), people: hub.snapshot() });

    socket.on("message", (raw: Buffer | string) => {
      const message = parseClientMessage(raw.toString());
      // A frame we cannot read is dropped. It is not evidence the socket is
      // bad, and disconnecting on it would make a single client bug look like
      // a server outage.
      if (!message) return;
      if (message.type === "ping") {
        hub.presence.heard(actorId);
        return;
      }
      hub.presence.moveSelf(actorId, message.at, message.facing, {
        // Spread deliberately: `head: undefined` when the client did not send
        // one leaves the last known head alone, while an explicit null clears
        // it. Only a client that mentions hands changes them.
        ...("head" in message ? { head: message.head ?? null } : {}),
        ...(message.hands ? { hands: message.hands } : {}),
      });
    });

    socket.on("close", () => hub.detach(actorId, socket));
    socket.on("error", () => hub.detach(actorId, socket));
  });
}

export { TICK_MS };
