import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { GO_COLOURS, GO_PLAYERS, defaultGoItem, isGoSize, parseRoomItem, type RoomItem } from "../../shared/room-items.js";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { roomKey } from "../../shared/space-room.js";
import { placeGoStone } from "../../shared/go-rules.js";

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
  app.patch<{ Params: { id: string }; Body: { size?: unknown; addBowl?: unknown; players?: unknown; reset?: unknown; position?: unknown; scale?: unknown; revision?: unknown; deskVisible?: unknown } }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    const change = request.body;
    if (change?.revision !== undefined && change.revision !== item.revision) return reply.code(409).send({ code: "TABLE_CHANGED", error: "The table changed. Try again." });
    if (change?.deskVisible !== undefined) {
      if (typeof change.deskVisible !== "boolean") return reply.code(400).send({ error: "Desk visibility must be true or false." });
      item.deskVisible = change.deskVisible;
    }
    if (change?.position !== undefined || change?.scale !== undefined) {
      if (item.liftedColour !== null) return reply.code(409).send({ error: "Place or return the flying stone before moving the table." });
      if (change.position !== undefined) {
        if (!change.position || typeof change.position !== "object") return reply.code(400).send({ error: "Position needs x, y, z and rotationY." });
        const p = change.position as Record<string, unknown>;
        if (![p.x, p.y, p.z, p.rotationY].every((n) => typeof n === "number" && Number.isFinite(n)) ||
          Math.abs(p.x as number) > 100 || Math.abs(p.z as number) > 100 || (p.y as number) < -0.5 || (p.y as number) > 5 || Math.abs(p.rotationY as number) > Math.PI * 2)
          return reply.code(400).send({ error: "Keep x/z within 100 m, height offset between −0.5 and 5 m, and rotation within one turn." });
        item.position = { x: p.x as number, y: p.y as number, z: p.z as number, rotationY: p.rotationY as number };
      }
      if (change.scale !== undefined) {
        if (typeof change.scale !== "number" || !Number.isFinite(change.scale) || change.scale < 0.45 || change.scale > 2.5) return reply.code(400).send({ error: "Table scale must be between 45% and 250%." });
        item.scale = change.scale;
      }
    }
    if (request.body?.size !== undefined) {
      if (!isGoSize(request.body.size)) return reply.code(400).send({ error: "size must be 5, 9, 13, 19, or 25" });
      if (item.size !== request.body.size) {
        item.size = request.body.size; item.stones = []; item.captures = [];
        item.liftedColour = null; item.carrier = null; item.activeColour = 0;
      }
    }
    if (request.body?.addBowl === true) {
      if (item.colours.length >= GO_COLOURS.length) return reply.code(422).send({ error: "every available bowl colour is already here" });
      item.colours.push(GO_COLOURS[item.colours.length]);
    }
    /**
     * HOW MANY ARE PLAYING, settable both ways.
     *
     * `addBowl` above can only ever go up, so a table that had seated a
     * seventh player was stuck with seven. Taking a seat away has to take that
     * player's stones and captures with it, or the board keeps pieces in a
     * colour nobody is holding and the turn order steps past an empty seat.
     */
    if (request.body?.players !== undefined) {
      const players = request.body.players;
      if (!Number.isInteger(players) || (players as number) < GO_PLAYERS.min || (players as number) > GO_PLAYERS.max) {
        return reply.code(400).send({ error: `players must be between ${GO_PLAYERS.min} and ${GO_PLAYERS.max}` });
      }
      const wanted = players as number;
      if (item.liftedColour !== null) return reply.code(409).send({ error: "Place or return the flying stone before changing the players." });
      item.colours = GO_COLOURS.slice(0, wanted).map((colour) => colour);
      item.stones = item.stones.filter((stone) => stone.colour < wanted);
      // A capture is a STONE that was taken, carrying both whose it was and
      // who took it. Both have to still be at the table for it to mean
      // anything, so a leaving player takes their own captures and the ones
      // made against them.
      item.captures = item.captures.filter((taken) => taken.colour < wanted && taken.by < wanted);
      if (item.activeColour >= wanted) item.activeColour = 0;
      item.carrier = null;
    }
    /** Take the stones off and give the turn back to the first player. */
    if (request.body?.reset === true) {
      item.stones = []; item.captures = [];
      item.liftedColour = null; item.carrier = null; item.activeColour = 0;
    }
    item.revision++;
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
  app.post<{ Params: { id: string }; Body: { action?: unknown; x?: unknown; y?: unknown; hand?: unknown; colour?: unknown; revision?: unknown } }>("/bff/space/items/:id/action", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (request.body?.revision !== undefined && request.body.revision !== item.revision) return reply.code(409).send({ code: "TABLE_CHANGED", error: "The table changed. Try again." });
    if (request.body?.action === "lift") {
      if (item.liftedColour !== null) return reply.code(409).send({ error: "A stone is already in flight. Place it or return it first." });
      if (request.body.colour !== undefined && request.body.colour !== item.activeColour) return reply.code(409).send({ error: "It is the glowing bowl's turn." });
      if (request.body.hand !== undefined && request.body.hand !== null && request.body.hand !== "left" && request.body.hand !== "right") return reply.code(400).send({ error: "Unknown hand." });
      if (request.body.hand && options.items.all(room).some((table) => table.carrier?.by === session.username && table.carrier.hand === request.body.hand)) return reply.code(409).send({ error: "That hand is already carrying a stone at another table." });
      item.liftedColour = item.activeColour;
      item.carrier = { by: session.username, hand: (request.body.hand as "left" | "right" | null) ?? null };
    }
    else if (request.body?.action === "place") {
      const { x, y } = request.body;
      if (item.liftedColour !== item.activeColour) return reply.code(409).send({ error: "lift the glowing stone first" });
      if (item.carrier && item.carrier.by !== session.username) return reply.code(409).send({ error: `${item.carrier.by} is carrying this stone.` });
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return reply.code(400).send({ error: "that intersection is not on the board" });
      const move = placeGoStone(item.stones, item.size, { id: randomUUID(), x: x as number, y: y as number, colour: item.activeColour });
      if ("error" in move) return reply.code(409).send({ error: move.error });
      item.stones = move.stones;
      item.captures.push(...move.captured.map((stone) => ({ ...stone, by: item.activeColour })));
      item.liftedColour = null; item.carrier = null; item.activeColour = (item.activeColour + 1) % item.colours.length;
    } else if (request.body?.action === "return") {
      // Deliberate recovery for a disconnected carrier; never steals on incidental contact.
      item.liftedColour = null; item.carrier = null;
    } else return reply.code(400).send({ error: "action must be lift, place or return" });
    item.revision++;
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
}
