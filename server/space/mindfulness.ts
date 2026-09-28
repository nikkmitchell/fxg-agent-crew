import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { actorKey } from "../../shared/space-layout.js";
import { roomKey } from "../../shared/space-room.js";
import { normalizeMindfulnessText, type SharedMindfulnessCard } from "../../shared/mindfulness.js";

const PAGE_SIZE = 12;
const DAILY_SHARE_LIMIT = 8;

type StoredCard = {
  seq: number;
  id: string;
  text: string;
  created_by: string;
  created_at: string;
};

/** Durable, room-local writing that a person deliberately chose to share. */
export class RoomMindfulnessCards {
  constructor(private readonly database: DatabaseSync) {}

  page(room: string, before: number | null, viewer: string): { cards: SharedMindfulnessCard[]; older: number | null } {
    const rows = (before === null
      ? this.database.prepare(
          "SELECT seq, id, text, created_by, created_at FROM space_mindfulness_cards WHERE room = ? ORDER BY seq DESC LIMIT ?",
        ).all(roomKey(room), PAGE_SIZE + 1)
      : this.database.prepare(
          "SELECT seq, id, text, created_by, created_at FROM space_mindfulness_cards WHERE room = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
        ).all(roomKey(room), before, PAGE_SIZE + 1)) as StoredCard[];

    const hasOlder = rows.length > PAGE_SIZE;
    const visible = rows.slice(0, PAGE_SIZE);
    return {
      cards: visible.map((row) => ({
        id: row.id,
        text: row.text,
        createdAt: row.created_at,
        mine: row.created_by === actorKey(viewer),
      })),
      older: hasOlder ? visible.at(-1)?.seq ?? null : null,
    };
  }

  share(room: string, author: string, text: string, at: number): SharedMindfulnessCard | { refused: string } {
    const dayAgo = new Date(at - 24 * 60 * 60 * 1000).toISOString();
    const count = this.database.prepare(
      "SELECT count(*) AS count FROM space_mindfulness_cards WHERE room = ? AND created_by = ? AND created_at >= ?",
    ).get(roomKey(room), actorKey(author), dayAgo) as { count: number };
    if (count.count >= DAILY_SHARE_LIMIT) return { refused: "You have shared enough cards for today. The page will still be here tomorrow." };

    const id = randomUUID();
    const createdAt = new Date(at).toISOString();
    this.database.prepare(
      "INSERT INTO space_mindfulness_cards (id, room, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, roomKey(room), text, actorKey(author), createdAt);
    return { id, text, createdAt, mine: true };
  }

  remove(room: string, id: string, author: string): boolean {
    const result = this.database.prepare(
      "DELETE FROM space_mindfulness_cards WHERE room = ? AND id = ? AND created_by = ?",
    ).run(roomKey(room), id, actorKey(author));
    return result.changes > 0;
  }
}

/**
 * GET    /bff/space/mindfulness                 latest page of room cards
 * GET    /bff/space/mindfulness?before=<cursor> older page
 * POST   /bff/space/mindfulness                 explicitly share a short reflection
 * DELETE /bff/space/mindfulness/:id             remove only the writer's card
 *
 * Draft text never reaches this route until the writer confirms the exact
 * preview. The response intentionally omits identity; `mine` is a private
 * per-viewer capability bit, not an author label.
 */
export function registerMindfulnessRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  cards: RoomMindfulnessCards;
  announce: (room: string) => void;
  now?: () => number;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const now = deps.now ?? Date.now;

  app.get<{ Querystring: { before?: string } }>("/bff/space/mindfulness", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const raw = request.query.before;
    let before: number | null = null;
    if (raw !== undefined) {
      if (!/^\d{1,16}$/u.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
        return reply.code(400).send({ code: "BAD_CURSOR", error: "That page marker is not valid." });
      }
      before = Number(raw);
    }
    return reply.header("cache-control", "no-store").send(deps.cards.page(spaceRoomOf(session), before, session.username));
  });

  app.post<{ Body: { text?: unknown } }>("/bff/space/mindfulness", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const text = normalizeMindfulnessText(request.body?.text);
    if (!text) return reply.code(400).send({ code: "BAD_CARD", error: "A shared reflection can be up to 240 characters." });
    const room = spaceRoomOf(session);
    const result = deps.cards.share(room, session.username, text, now());
    if ("refused" in result) return reply.code(429).send({ code: "SHARE_LIMIT", error: result.refused });
    deps.announce(room);
    return reply.code(201).send({ card: result });
  });

  app.delete<{ Params: { id: string } }>("/bff/space/mindfulness/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const id = request.params.id;
    if (id.length > 64) return reply.code(404).send({ code: "NOT_FOUND", error: "That card is not yours to remove." });
    const room = spaceRoomOf(session);
    if (!deps.cards.remove(room, id, session.username)) {
      // Do not reveal whether another person owns a card with this id.
      return reply.code(404).send({ code: "NOT_FOUND", error: "That card is not yours to remove." });
    }
    deps.announce(room);
    return reply.send({ ok: true });
  });
}
