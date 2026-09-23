import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { GO_COLOURS, GO_PLAYERS, defaultGoItem, isGoSize, parseRoomItem, tableRefusal, type RoomItem } from "../../shared/room-items.js";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { roomKey } from "../../shared/space-room.js";

export class RoomItems {
  constructor(private readonly database: DatabaseSync) {}
  all(room: string): RoomItem[] {
    return (this.database.prepare("SELECT state_json FROM space_items WHERE room = ? ORDER BY added_at").all(roomKey(room)) as { state_json: string }[])
      .map((row) => parseRoomItem(JSON.parse(row.state_json))).filter((item): item is RoomItem => item !== null);
  }
  one(room: string, id: string): RoomItem | null {
    const row = this.database.prepare("SELECT state_json FROM space_items WHERE room = ? AND id = ?").get(roomKey(room), id) as { state_json: string } | undefined;
    return row ? parseRoomItem(JSON.parse(row.state_json)) : null;
  }
  add(room: string, by: string): RoomItem {
    const item = defaultGoItem(randomUUID(), this.all(room).length);
    const now = new Date().toISOString();
    this.database.prepare("INSERT INTO space_items (id, kind, state_json, added_by, added_at, updated_by, updated_at, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.kind, JSON.stringify(item), by, now, by, now, roomKey(room));
    return item;
  }
  save(room: string, item: RoomItem, by: string): void {
    this.database.prepare("UPDATE space_items SET state_json = ?, updated_by = ?, updated_at = ? WHERE room = ? AND id = ?")
      .run(JSON.stringify(item), by, new Date().toISOString(), roomKey(room), item.id);
  }
}

export function registerRoomItemRoutes(app: FastifyInstance, options: {
  config: Config; sessions: SessionStore; items: RoomItems; announce: (room: string, items: RoomItem[], by: string) => void;
}) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const publish = (room: string, by: string) => { const items = options.items.all(room); options.announce(room, items, by); return items; };
  app.get("/bff/space/items", async (request, reply) => {
    const session = requireSession(request, reply); return session ? reply.send({ items: options.items.all(spaceRoomOf(session)) }) : reply;
  });
  app.post<{ Body: { kind?: unknown } }>("/bff/space/items", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    if (request.body?.kind !== "go") return reply.code(400).send({ code: "BAD_KIND", error: "the first room item is a Go table" });
    const room = spaceRoomOf(session); const item = options.items.add(room, session.username); publish(room, session.username); return reply.code(201).send({ item });
  });
  app.patch<{
    Params: { id: string };
    Body: { size?: unknown; addBowl?: unknown; players?: unknown; reset?: unknown; position?: unknown };
  }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (request.body?.size !== undefined) {
      if (!isGoSize(request.body.size)) return reply.code(400).send({ error: "size must be 5, 9, 13, 19, or 25" });
      item.size = request.body.size; item.stones = []; item.liftedColour = null; item.activeColour = 0;
    }
    if (request.body?.addBowl === true) {
      if (item.colours.length >= GO_COLOURS.length) return reply.code(422).send({ error: "every available bowl colour is already here" });
      item.colours.push(GO_COLOURS[item.colours.length]);
    }
    /**
     * HOW MANY ARE PLAYING, settable both ways.
     *
     * `addBowl` could only ever go up, so a room that had added a seventh
     * player was stuck with seven. Taking a bowl away has to take that
     * player's stones with it, or the board keeps pieces in a colour nobody
     * is holding and the turn order steps past an empty seat.
     */
    if (request.body?.players !== undefined) {
      const players = request.body.players;
      if (!Number.isInteger(players) || (players as number) < GO_PLAYERS.min || (players as number) > GO_PLAYERS.max) {
        return reply.code(400).send({ error: `players must be between ${GO_PLAYERS.min} and ${GO_PLAYERS.max}` });
      }
      const wanted = players as number;
      item.colours = GO_COLOURS.slice(0, wanted).map((colour) => colour);
      item.stones = item.stones.filter((stone) => stone.colour < wanted);
      if (item.activeColour >= wanted) item.activeColour = 0;
      if (item.liftedColour !== null && item.liftedColour >= wanted) item.liftedColour = null;
    }
    if (request.body?.reset === true) {
      item.stones = []; item.liftedColour = null; item.activeColour = 0;
    }
    /**
     * WHERE THE TABLE STANDS. Nikk: "lets allow for moving the go board in the
     * same way" — the same grab-and-drag as the panels, rather than the buttons
     * that were there, which they called "super weird". Refused by the same
     * rule the client applies before it ever sends this.
     */
    if (request.body?.position !== undefined) {
      const at = request.body.position as { x?: unknown; z?: unknown; rotationY?: unknown };
      const x = at?.x, z = at?.z, rotationY = at?.rotationY ?? item.position.rotationY;
      if (![x, z, rotationY].every((value) => typeof value === "number" && Number.isFinite(value))) {
        return reply.code(400).send({ error: "a position needs a finite x, z and rotationY" });
      }
      const refused = tableRefusal({ x: x as number, z: z as number });
      if (refused) return reply.code(422).send({ error: refused });
      item.position = { x: x as number, z: z as number, rotationY: rotationY as number };
    }
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
  app.post<{ Params: { id: string }; Body: { action?: unknown; x?: unknown; y?: unknown } }>("/bff/space/items/:id/action", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
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
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
}
