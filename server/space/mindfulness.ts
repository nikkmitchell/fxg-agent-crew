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
const SHARE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  page(room: string, before: number | null, viewer: string, at = Date.now()): { cards: SharedMindfulnessCard[]; older: number | null } {
    this.pruneExpiredShareEvents(at);
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
    const cutoff = new Date(at - SHARE_WINDOW_MS).toISOString();
    const normalizedRoom = roomKey(room);
    const normalizedAuthor = actorKey(author);
    const createdAt = new Date(at).toISOString();

    // The writer lock makes the count-and-insert one operation even when
    // multiple server processes share the same SQLite database.
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        "DELETE FROM space_mindfulness_share_events WHERE created_at <= ?",
      ).run(cutoff);
      const count = this.database.prepare(
        "SELECT count(*) AS count FROM space_mindfulness_share_events WHERE room = ? AND created_by = ? AND created_at > ?",
      ).get(normalizedRoom, normalizedAuthor, cutoff) as { count: number };
      if (count.count >= DAILY_SHARE_LIMIT) {
        this.database.exec("COMMIT");
        return { refused: "You can share up to 8 cards in any rolling 24-hour period. Removing a card will not reset the limit." };
      }

      const id = randomUUID();
      this.database.prepare(
        "INSERT INTO space_mindfulness_share_events (room, created_by, created_at) VALUES (?, ?, ?)",
      ).run(normalizedRoom, normalizedAuthor, createdAt);
      this.database.prepare(
        "INSERT INTO space_mindfulness_cards (id, room, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, normalizedRoom, text, normalizedAuthor, createdAt);
      this.database.exec("COMMIT");
      return { id, text, createdAt, mine: true };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  remove(room: string, id: string, author: string): boolean {
    const result = this.database.prepare(
      "DELETE FROM space_mindfulness_cards WHERE room = ? AND id = ? AND created_by = ?",
    ).run(roomKey(room), id, actorKey(author));
    return result.changes > 0;
  }

  private pruneExpiredShareEvents(at: number): void {
    const cutoff = new Date(at - SHARE_WINDOW_MS).toISOString();
    this.database.prepare(
      "DELETE FROM space_mindfulness_share_events WHERE created_at <= ?",
    ).run(cutoff);
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
    return reply.header("cache-control", "no-store").send(deps.cards.page(spaceRoomOf(session), before, session.username, now()));
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
