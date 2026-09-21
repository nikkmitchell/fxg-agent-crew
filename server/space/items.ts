import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { GO_COLOURS, defaultGoItem, isGoSize, parseRoomItem, type RoomItem } from "../../shared/room-items.js";
import type { Config } from "../config.js";
import { makeRequireSession } from "../require-session.js";
import type { SessionStore } from "../session.js";

export class RoomItems {
  constructor(private readonly database: DatabaseSync) {}
  all(): RoomItem[] {
    return (this.database.prepare("SELECT state_json FROM space_items ORDER BY added_at").all() as { state_json: string }[])
      .map((row) => parseRoomItem(JSON.parse(row.state_json))).filter((item): item is RoomItem => item !== null);
  }
  one(id: string): RoomItem | null {
    const row = this.database.prepare("SELECT state_json FROM space_items WHERE id = ?").get(id) as { state_json: string } | undefined;
    return row ? parseRoomItem(JSON.parse(row.state_json)) : null;
  }
  add(by: string): RoomItem {
    const item = defaultGoItem(randomUUID(), this.all().length);
    const now = new Date().toISOString();
    this.database.prepare("INSERT INTO space_items VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.kind, JSON.stringify(item), by, now, by, now);
    return item;
  }
  save(item: RoomItem, by: string): void {
    this.database.prepare("UPDATE space_items SET state_json = ?, updated_by = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(item), by, new Date().toISOString(), item.id);
  }
}

export function registerRoomItemRoutes(app: FastifyInstance, options: {
  config: Config; sessions: SessionStore; items: RoomItems; announce: (items: RoomItem[], by: string) => void;
}) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const publish = (by: string) => { const items = options.items.all(); options.announce(items, by); return items; };
  app.get("/bff/space/items", async (request, reply) => requireSession(request, reply) ? reply.send({ items: options.items.all() }) : reply);
  app.post<{ Body: { kind?: unknown } }>("/bff/space/items", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    if (request.body?.kind !== "go") return reply.code(400).send({ code: "BAD_KIND", error: "the first room item is a Go table" });
    const item = options.items.add(session.username); publish(session.username); return reply.code(201).send({ item });
  });
  app.patch<{ Params: { id: string }; Body: { size?: unknown; addBowl?: unknown } }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const item = options.items.one(request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (request.body?.size !== undefined) {
      if (!isGoSize(request.body.size)) return reply.code(400).send({ error: "size must be 5, 9, 13, 19, or 25" });
      item.size = request.body.size; item.stones = []; item.liftedColour = null; item.activeColour = 0;
    }
    if (request.body?.addBowl === true) {
      if (item.colours.length >= GO_COLOURS.length) return reply.code(422).send({ error: "every available bowl colour is already here" });
      item.colours.push(GO_COLOURS[item.colours.length]);
    }
    options.items.save(item, session.username); publish(session.username); return reply.send({ item });
  });
  app.post<{ Params: { id: string }; Body: { action?: unknown; x?: unknown; y?: unknown } }>("/bff/space/items/:id/action", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const item = options.items.one(request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (request.body?.action === "lift") item.liftedColour = item.activeColour;
    else if (request.body?.action === "place") {
      const { x, y } = request.body;
      if (item.liftedColour !== item.activeColour) return reply.code(409).send({ error: "lift the glowing stone first" });
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return reply.code(400).send({ error: "that intersection is not on the board" });
      if (item.stones.some((stone) => stone.x === x && stone.y === y)) return reply.code(409).send({ error: "that intersection is occupied" });
      item.stones.push({ x: x as number, y: y as number, colour: item.activeColour });
      item.liftedColour = null; item.activeColour = (item.activeColour + 1) % item.colours.length;
    } else return reply.code(400).send({ error: "action must be lift or place" });
    options.items.save(item, session.username); publish(session.username); return reply.send({ item });
  });
}
