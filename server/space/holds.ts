import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";

/**
 * Who is holding what, so two people cannot drag the same thing at once.
 *
 * Nikk, testing the Go table with somebody else in the room: "we'll need to have
 * a case for two people are moving it at the same time — maybe if somebody's
 * already grabbed it then it's not movable".
 *
 * Nothing recorded who was holding anything. A panel saved its place on release
 * and the last release won; the Go table's carry is retried once after "the
 * table changed", so two people carrying it both succeeded and the later one
 * simply overwrote the other. A thing somebody is holding can now be taken by
 * nobody else, and a write from anybody else is refused while it is held.
 *
 * LOCAL FIRST, as Nikk also asked: "allow me to change it first and then it
 * should update the server". A grab does not WAIT for this. The client starts
 * moving at once and asks in the background; only if somebody else already has
 * it does the grab let go and say who. So the lock costs a person nothing
 * except in the one case it exists for.
 *
 * A HOLD EXPIRES. It lives for TTL_MS and is renewed while the drag goes on, so
 * a tab that crashes, a headset taken off mid-drag or a dropped connection can
 * never leave something locked for good. In memory, like presence: a restart
 * forgets every hold, which is exactly right, because a restart also ended
 * every drag.
 */

/** How long a hold lasts without being renewed. A drag renews well inside it. */
export const TTL_MS = 8_000;

/** What can be held: a panel, or a room item such as the Go table. */
const THING = /^(panel|item):[A-Za-z0-9_.:-]{1,120}$/;

export class Holds {
  private readonly held = new Map<string, { actorId: string; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(room: string, thing: string): string {
    return `${room}\u0000${thing}`;
  }

  /** Who holds this now, or null — expired holds are nobody's. */
  holder(room: string, thing: string): string | null {
    const hold = this.held.get(this.key(room, thing));
    if (!hold) return null;
    if (hold.until <= this.now()) {
      this.held.delete(this.key(room, thing));
      return null;
    }
    return hold.actorId;
  }

  /** Somebody OTHER than this actor holding it, or null. */
  heldByOther(room: string, thing: string, actorId: string): string | null {
    const holder = this.holder(room, thing);
    return holder && actorKey(holder) !== actorKey(actorId) ? holder : null;
  }

  /**
   * Take it, or renew a hold already yours. Refused, naming the holder, when
   * somebody else has it — case-folded, because the room folds names
   * everywhere and a hold must not be stolen by re-spelling yourself.
   */
  take(room: string, thing: string, actorId: string): { ok: true } | { heldBy: string } {
    const other = this.heldByOther(room, thing, actorId);
    if (other) return { heldBy: other };
    this.held.set(this.key(room, thing), { actorId, until: this.now() + TTL_MS });
    return { ok: true };
  }

  /** Let go. Only the holder can: nobody else releases your grip for you. */
  release(room: string, thing: string, actorId: string): void {
    const holder = this.holder(room, thing);
    if (holder && actorKey(holder) === actorKey(actorId)) this.held.delete(this.key(room, thing));
  }
}

/** The sentence a refused grab or write shows, the same everywhere. */
export const heldBySentence = (actorId: string): string => `${actorId} is moving this right now.`;

/**
 *   POST /bff/space/holds  { "thing": "panel:said", "held": true }   take or renew
 *   POST /bff/space/holds  { "thing": "panel:said", "held": false }  let go
 *
 * 409 HELD, naming the holder, when somebody else has it.
 */
export function registerHoldRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; holds: Holds },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.post<{ Body: { thing?: unknown; held?: unknown } }>("/bff/space/holds", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { thing, held } = request.body ?? {};
    if (typeof thing !== "string" || !THING.test(thing) || typeof held !== "boolean") {
      return reply
        .code(400)
        .send({ code: "BAD_HOLD", error: 'a hold needs "thing" ("panel:<id>" or "item:<id>") and "held" (true or false)' });
    }
    const room = spaceRoomOf(session);
    if (!held) {
      deps.holds.release(room, thing, session.username);
      return reply.send({ ok: true, held: false });
    }
    const taken = deps.holds.take(room, thing, session.username);
    if ("heldBy" in taken) {
      return reply.code(409).send({ code: "HELD", heldBy: taken.heldBy, error: heldBySentence(taken.heldBy) });
    }
    return reply.send({ ok: true, held: true, ttlMs: TTL_MS });
  });
}
