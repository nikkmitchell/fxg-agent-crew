import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { ServerMessage } from "../../shared/space-wire.js";
import { BOAT_REST_MS, afloat, type Boat } from "../../shared/boats.js";
import { LANTERN_REST_MS, cleanWord, stillAloft, type Lantern } from "../../shared/lantern.js";
import { DRIFT_REST_MS, cleanDrift } from "../../shared/driftwood.js";
import { OFFER_REST_MS, cleanOffering } from "../../shared/fire.js";
import { LIGHT_REST_MS, burning, freeSlot, type Stick } from "../../shared/incense.js";
import { turnOver, type Hourglass } from "../../shared/hourglass.js";
import { PUSH_REST_MS, pushStrength, type WheelPush } from "../../shared/wheel.js";
import { BATH_SECONDS } from "../../shared/sound-bath.js";

/**
 * THE ROOM'S MOMENTS: a boat set on the pond, a lantern let go, a word on
 * driftwood or given to the fire, a stick of incense, the hourglass turned, the
 * prayer wheel pushed, a sound bath begun. Somebody does it, the whole room is
 * told, it is kept in memory for as long as it lasts (minutes, not days), and
 * one person waits a moment before their next.
 *
 *   GET  /bff/space/<moment>   how it stands in your room (those with something to look at)
 *   POST /bff/space/<moment>   do it, for everyone
 *
 * These were eight files, each with its own copy of the session check, the
 * room, the rest between turns and the telling (Kerf, 2026-10-14; Nikk: "it
 * seems like we have multiple systems for different things"). What stays each
 * one's own is below: what it keeps, and what doing it means, with its rules in
 * shared/<moment>.ts. server/__tests__/room-moments.test.ts says what each does.
 */

type Refused = { status: number; code: string; error: string };
type Done = { answer: Record<string, unknown>; tell: ServerMessage };

export type Moment = {
  path: string;
  /** Between one person's turns, and what they are told if they come back sooner. */
  rest?: { ms: number; tooSoon: string };
  /** How it stands in this room now. */
  look?: (room: string, now: number) => Record<string, unknown>;
  /** Doing it: what to answer and what to tell the room, or why not. */
  act: (room: string, by: string, body: Record<string, unknown>, now: number) => Done | Refused;
};

/** A room's list, forgotten once it is empty, so rooms nobody uses keep nothing. */
function keep<T>(rooms: Map<string, T[]>, room: string, list: T[]): T[] {
  if (list.length) rooms.set(room, list);
  else rooms.delete(room);
  return list;
}

const boats = (): Moment => {
  const ponds = new Map<string, Boat[]>();
  return {
    path: "/bff/space/boats",
    rest: { ms: BOAT_REST_MS, tooSoon: "Let the last one sail first." },
    look: (room, now) => ({ boats: keep(ponds, room, afloat(ponds.get(room) ?? [], now)), now }),
    act: (room, by, _body, now) => {
      const boat: Boat = { id: randomUUID().slice(0, 8), by, at: now, seed: Math.random() };
      keep(ponds, room, afloat([...(ponds.get(room) ?? []), boat], now));
      return { answer: { boat, now }, tell: { type: "boat", boat } };
    },
  };
};

const lanterns = (): Moment => {
  const skies = new Map<string, Lantern[]>();
  return {
    path: "/bff/space/lanterns",
    rest: { ms: LANTERN_REST_MS, tooSoon: "Watch the last one rise first." },
    look: (room, now) => ({ lanterns: keep(skies, room, stillAloft(skies.get(room) ?? [], now)), now }),
    act: (room, by, body, now) => {
      const lantern: Lantern = { id: randomUUID().slice(0, 8), by, word: cleanWord(body.word), at: now, seed: Math.random() };
      keep(skies, room, stillAloft([...(skies.get(room) ?? []), lantern], now));
      return { answer: { lantern, now }, tell: { type: "lantern", lantern } };
    },
  };
};

/** Driftwood: told to the room, then forgotten. Nothing is stored or logged: the sea takes it. */
const driftwood = (): Moment => ({
  path: "/bff/space/driftwood",
  rest: { ms: DRIFT_REST_MS, tooSoon: "Let the last one float away first." },
  act: (_room, by, body, now) => {
    const word = cleanDrift(body.word);
    if (!word) return { status: 422, code: "EMPTY", error: "Write a word on the wood." };
    return { answer: { ok: true }, tell: { type: "driftwood", drift: { by, word, at: now } } };
  },
});

/** The ember fire: told to the room, then forgotten, because letting go is the point. */
const fire = (): Moment => ({
  path: "/bff/space/fire",
  rest: { ms: OFFER_REST_MS, tooSoon: "Let the last one burn first." },
  act: (_room, by, body, now) => {
    const word = cleanOffering(body.word);
    if (!word) return { status: 422, code: "EMPTY", error: "Give the fire a word." };
    return { answer: { ok: true }, tell: { type: "fire", offering: { by, word, at: now } } };
  },
});

const incense = (): Moment => {
  const bowls = new Map<string, Stick[]>();
  return {
    path: "/bff/space/incense",
    rest: { ms: LIGHT_REST_MS, tooSoon: "Let the last one catch first." },
    look: (room, now) => ({ sticks: keep(bowls, room, burning(bowls.get(room) ?? [], now)), now }),
    act: (room, by, _body, now) => {
      const sticks = burning(bowls.get(room) ?? [], now);
      const slot = freeSlot(sticks);
      if (slot === null) return { status: 422, code: "FULL", error: "The bowl is full; wait for one to burn down." };
      const next = keep(bowls, room, [...sticks, { id: randomUUID().slice(0, 8), by, at: now, slot }]);
      return { answer: { sticks: next, now }, tell: { type: "incense", sticks: next } };
    },
  };
};

const hourglass = (): Moment => {
  const glasses = new Map<string, Hourglass>();
  const unturned: Hourglass = { turnedAt: null, topThen: 0 };
  return {
    path: "/bff/space/hourglass",
    rest: { ms: 1500, tooSoon: "Let it settle." },
    look: (room, now) => ({ glass: glasses.get(room) ?? unturned, now }),
    act: (room, _by, _body, now) => {
      const glass = turnOver(glasses.get(room) ?? unturned, now);
      glasses.set(room, glass);
      return { answer: { glass, now }, tell: { type: "hourglass", glass } };
    },
  };
};

/** The count is of turns since the server started, and says so. */
const wheel = (): Moment => {
  const turns = new Map<string, number>();
  return {
    path: "/bff/space/wheel",
    rest: { ms: PUSH_REST_MS, tooSoon: "Let it turn." },
    look: (room) => ({ turns: turns.get(room) ?? 0 }),
    act: (room, by, body) => {
      const count = (turns.get(room) ?? 0) + 1;
      turns.set(room, count);
      const push: WheelPush = { by, strength: pushStrength(body.strength), turns: count };
      return { answer: { push }, tell: { type: "wheel", push } };
    },
  };
};

/** { action: "start" | "stop" }. One at a time, six minutes long; anybody may stop it. */
const soundBath = (): Moment => {
  const baths = new Map<string, number>();
  const playing = (room: string, now: number) => {
    const at = baths.get(room);
    if (at !== undefined && now - at < BATH_SECONDS * 1000) return at;
    baths.delete(room);
    return null;
  };
  return {
    path: "/bff/space/sound-bath",
    look: (room, now) => ({ startedAt: playing(room, now), now }),
    act: (room, by, body, now) => {
      if (body.action === "stop") {
        baths.delete(room);
        return { answer: { startedAt: null, now }, tell: { type: "bath", bath: { startedAt: null, by } } };
      }
      if (playing(room, now) !== null) return { status: 409, code: "PLAYING", error: "A sound bath is already playing." };
      baths.set(room, now);
      return { answer: { startedAt: now, now }, tell: { type: "bath", bath: { startedAt: now, by } } };
    },
  };
};

/** Every moment, each keeping its own rooms: one set per server. */
export const roomMoments = (): Moment[] => [boats(), lanterns(), driftwood(), fire(), incense(), hourglass(), wheel(), soundBath()];

export function registerMomentRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  /** Tell everyone in a room. */
  tell: (room: string, message: ServerMessage) => void;
  moments?: Moment[];
  now?: () => number;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const clock = deps.now ?? Date.now;
  for (const moment of deps.moments ?? roomMoments()) {
    const { look, rest } = moment;
    /** When each person last did this, by lower-cased name. */
    const last = new Map<string, number>();
    if (look) {
      app.get(moment.path, async (request, reply) => {
        const session = requireSession(request, reply);
        if (!session) return reply;
        return reply.send(look(spaceRoomOf(session), clock()));
      });
    }
    app.post<{ Body: unknown }>(moment.path, async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const now = clock();
      const who = session.username.toLowerCase();
      const before = last.get(who);
      if (rest && before !== undefined && now - before < rest.ms) return reply.code(429).send({ code: "TOO_SOON", error: rest.tooSoon });
      const room = spaceRoomOf(session);
      const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {};
      const done = moment.act(room, session.username, body, now);
      if ("error" in done) return reply.code(done.status).send({ code: done.code, error: done.error });
      if (rest) {
        last.set(who, now);
        if (last.size > 500) for (const [name, at] of last) if (now - at >= rest.ms) last.delete(name);
      }
      deps.tell(room, done.tell);
      return reply.send(done.answer);
    });
  }
}
