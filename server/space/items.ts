import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { GO_COLOURS, GO_RISKS, GO_STYLES, defaultGoItem, isGoSize, parseRoomItem, type GoMode, type GoPlayCard, type RoomItem } from "../../shared/room-items.js";
import { applyGoMove, scoreGoArea, suggestGoMove } from "../../shared/go-engine.js";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { roomKey } from "../../shared/space-room.js";

const goActorKey = (actorId: string) => actorId.toLocaleLowerCase("en-US");

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
  playerCard(room: string, itemId: string, actorId: string): GoPlayCard | null {
    const row = this.database.prepare("SELECT style, risk, signature FROM go_player_cards WHERE room = ? AND item_id = ? AND actor_id = ?")
      .get(roomKey(room), itemId, goActorKey(actorId)) as { style: GoPlayCard["style"]; risk: GoPlayCard["risk"]; signature: string } | undefined;
    return row ? { style: row.style, risk: row.risk, signature: row.signature } : null;
  }
  savePlayerCard(room: string, itemId: string, actorId: string, card: GoPlayCard): void {
    this.database.prepare(`INSERT INTO go_player_cards (room, item_id, actor_id, style, risk, signature, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room, item_id, actor_id) DO UPDATE SET style = excluded.style, risk = excluded.risk,
        signature = excluded.signature, updated_at = excluded.updated_at`)
      .run(roomKey(room), itemId, goActorKey(actorId), card.style, card.risk, card.signature, new Date().toISOString());
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
  app.patch<{ Params: { id: string }; Body: { size?: unknown; addBowl?: unknown } }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (request.body?.size !== undefined) {
      if (!isGoSize(request.body.size)) return reply.code(400).send({ error: "size must be 5, 9, 13, 19, or 25" });
      if ((item.moveNumber > 0 && !item.gameOver) || item.liftedColour !== null || item.turnActor !== null)
        return reply.code(409).send({ error: "finish the current game or put the picked-up stone back before resetting the board" });
      item.size = request.body.size; item.stones = []; item.liftedColour = null;
      item.activeColour = 0; item.turnActor = null;
      item.previousPosition = null; item.moveNumber = 0; item.consecutivePasses = 0; item.gameOver = false; item.score = null;
    }
    if (request.body?.addBowl === true) {
      if (item.moveNumber > 0 || item.stones.length > 0 || item.liftedColour !== null || item.turnActor !== null)
        return reply.code(409).send({ error: "add bowls before the first move" });
      if (item.colours.length >= GO_COLOURS.length) return reply.code(422).send({ error: "every available bowl colour is already here" });
      item.colours.push(GO_COLOURS[item.colours.length]);
      item.seats.push(null);
    }
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
  app.post<{ Params: { id: string }; Body: { action?: unknown; x?: unknown; y?: unknown; expectedMoveNumber?: unknown } }>("/bff/space/items/:id/action", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    if (!Number.isInteger(request.body?.expectedMoveNumber) || request.body?.expectedMoveNumber !== item.moveNumber)
      return reply.code(409).send({ error: "the board changed; refresh it and choose again", code: "STALE_GO_TURN" });
    const action = request.body?.action;
    if (action !== "lift" && action !== "place" && action !== "return") return reply.code(400).send({ error: "action must be lift, place, or return" });
    if (item.gameOver) return reply.code(409).send({ error: "this game has ended; resize the board to start a fresh game" });
    const playerSeat = item.seats.findIndex((seat) => seat?.toLocaleLowerCase("en-US") === session.username.toLocaleLowerCase("en-US"));
    if (item.mode === "roles") {
      if (playerSeat < 0) return reply.code(409).send({ error: "choose an open bowl to claim a color before playing" });
      if (playerSeat !== item.activeColour) return reply.code(409).send({ error: "it is another player's turn" });
    } else if (item.turnActor && goActorKey(item.turnActor) !== goActorKey(session.username)) {
      return reply.code(409).send({ error: "another player has picked up this turn" });
    }
    if (action === "return") {
      if (item.liftedColour !== item.activeColour) return reply.code(409).send({ error: "there is no picked-up stone to return" });
      if (item.mode === "open") {
        if (!item.turnActor || goActorKey(item.turnActor) !== goActorKey(session.username))
          return reply.code(409).send({ error: "only the person holding this Open turn can return its stone" });
        item.turnActor = null;
      }
      item.liftedColour = null;
      options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
    }
    const card = options.items.playerCard(room, item.id, session.username);
    if (card?.style === "observer") return reply.code(409).send({ error: "your Go card is set to observe, so it will not make a move" });
    if (action === "lift") {
      if (item.mode === "open" && !item.turnActor) item.turnActor = session.username;
      item.liftedColour = item.activeColour;
    } else {
      const { x, y } = request.body;
      if (item.mode === "open" && goActorKey(item.turnActor ?? "") !== goActorKey(session.username))
        return reply.code(409).send({ error: "pick up the glowing stone to claim this turn first" });
      if (item.liftedColour !== item.activeColour) return reply.code(409).send({ error: "lift the glowing stone first" });
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return reply.code(400).send({ error: "that intersection is not on the board" });
      const applied = applyGoMove(item, item.activeColour, { x: x as number, y: y as number });
      if (!applied.ok) return reply.code(409).send({ error: moveRefusal(applied.reason) });
      item.stones = applied.stones; item.previousPosition = applied.previousPosition;
      item.moveNumber += 1; item.consecutivePasses = applied.consecutivePasses; item.gameOver = applied.gameOver;
      item.liftedColour = null; item.turnActor = null; item.score = null; item.activeColour = nextColour(item, item.activeColour);
    }
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });

  app.get<{ Params: { id: string } }>("/bff/space/items/:id/player", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id);
    if (!item) return reply.code(404).send({ error: "room item not found" });
    const actorKey = session.username.toLocaleLowerCase("en-US");
    return reply.send({ mode: item.mode, seat: item.seats.findIndex((seat) => seat?.toLocaleLowerCase("en-US") === actorKey), card: options.items.playerCard(room, item.id, session.username) });
  });

  app.put<{ Params: { id: string }; Body: { action?: unknown; colour?: unknown; style?: unknown; risk?: unknown; signature?: unknown; mode?: unknown } }>("/bff/space/items/:id/player", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id);
    if (!item) return reply.code(404).send({ error: "room item not found" });
    const actorKey = session.username.toLocaleLowerCase("en-US");
    if (request.body?.action === "mode") {
      const requestedMode = request.body.mode;
      if (requestedMode !== "open" && requestedMode !== "roles" && requestedMode !== "seated") return reply.code(400).send({ error: "mode must be open or roles" });
      const mode: GoMode = requestedMode === "open" ? "open" : "roles";
      if (item.moveNumber > 0 || item.stones.length > 0 || item.liftedColour !== null || item.turnActor !== null)
        return reply.code(409).send({ error: "choose a mode before the first move" });
      if (item.mode === mode) return reply.send({ item });
      item.mode = mode as GoMode;
      item.seats = item.colours.map(() => null);
      item.activeColour = 0;
      options.items.save(room, item, session.username); publish(room, session.username);
      return reply.send({ item });
    }
    if (request.body?.action === "sit") {
      if (item.mode !== "roles") return reply.code(409).send({ error: "switch to Roles mode to claim a color" });
      const current = item.seats.findIndex((seat) => seat?.toLocaleLowerCase("en-US") === actorKey);
      const requested = request.body.colour;
      const colour = requested === undefined ? (current >= 0 ? current : item.seats.findIndex((seat) => seat === null)) : requested;
      if (!Number.isInteger(colour) || (colour as number) < 0 || (colour as number) >= item.colours.length)
        return reply.code(400).send({ error: "choose an available bowl colour" });
      const seat = colour as number;
      if (current >= 0 && current !== seat) return reply.code(409).send({ error: "leave your current bowl before choosing another" });
      const owner = item.seats[seat];
      if (owner && owner.toLocaleLowerCase("en-US") !== actorKey) return reply.code(409).send({ error: "that bowl already has a player" });
      item.seats[seat] = session.username;
      if (!item.seats.some((value, index) => value !== null && index !== seat)) item.activeColour = 0;
      options.items.save(room, item, session.username); publish(room, session.username);
      return reply.send({ item, seat });
    }
    if (request.body?.action === "stand") {
      const seat = item.seats.findIndex((owner) => owner?.toLocaleLowerCase("en-US") === actorKey);
      if (seat < 0) return reply.code(409).send({ error: "you have no color role at this table" });
      item.seats[seat] = null;
      if (item.liftedColour === seat) item.liftedColour = null;
      if (item.activeColour === seat) item.activeColour = nextColour(item, seat);
      options.items.save(room, item, session.username); publish(room, session.username);
      return reply.send({ item, seat: null });
    }
    if (request.body?.action === "card") {
      const { style, risk, signature } = request.body;
      if (!(GO_STYLES as readonly unknown[]).includes(style)) return reply.code(400).send({ error: `style must be one of ${GO_STYLES.join(", ")}` });
      if (!(GO_RISKS as readonly unknown[]).includes(risk)) return reply.code(400).send({ error: `risk must be one of ${GO_RISKS.join(", ")}` });
      if (signature !== undefined && (typeof signature !== "string" || signature.length > 120)) return reply.code(400).send({ error: "signature must be at most 120 characters" });
      const card: GoPlayCard = { style: style as GoPlayCard["style"], risk: risk as GoPlayCard["risk"], signature: (signature as string | undefined ?? "").trim() };
      options.items.savePlayerCard(room, item.id, session.username, card);
      return reply.send({ card });
    }
    return reply.code(400).send({ error: "action must be mode, sit, stand, or card" });
  });

  app.post<{ Params: { id: string }; Body: { action?: unknown; x?: unknown; y?: unknown; expectedMoveNumber?: unknown } }>("/bff/space/items/:id/play", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id);
    if (!item) return reply.code(404).send({ error: "room item not found" });
    if (!Number.isInteger(request.body?.expectedMoveNumber) || request.body?.expectedMoveNumber !== item.moveNumber)
      return reply.code(409).send({ error: "the board changed; refresh it and choose again", code: "STALE_GO_TURN" });
    if (item.gameOver) return reply.code(409).send({ error: "this game has ended; resize the board to start a fresh game" });
    const seat = item.seats.findIndex((owner) => owner?.toLocaleLowerCase("en-US") === session.username.toLocaleLowerCase("en-US"));
    if (item.mode === "roles" && seat < 0) return reply.code(409).send({ error: "choose an open bowl to claim a color before playing" });
    if (item.mode === "open" && item.turnActor && goActorKey(item.turnActor) !== goActorKey(session.username))
      return reply.code(409).send({ error: "another player has picked up this turn" });
    const colour = item.mode === "open" ? item.activeColour : seat;
    if (item.mode === "roles" && colour !== item.activeColour) return reply.code(409).send({ error: "it is another player's turn" });
    const card = options.items.playerCard(room, item.id, session.username);
    if (!card) return reply.code(409).send({ error: "choose your own Go play card before asking for an agent move" });
    if (card.style === "observer") return reply.code(409).send({ error: "your Go card is set to observe, so it will not make a move" });
    let suggestion: ReturnType<typeof suggestGoMove> = null;
    if (request.body.action === "suggest") {
      suggestion = suggestGoMove(item, colour, card, session.username);
      if (!suggestion) return reply.code(409).send({ error: "there is no legal move; pass or end this game" });
      request.body.x = suggestion.x; request.body.y = suggestion.y;
    }
    if (request.body.action === "pass") {
      item.liftedColour = null; item.turnActor = null; item.previousPosition = null; item.moveNumber += 1; item.consecutivePasses += 1;
      const players = item.mode === "open" ? item.colours.length : item.seats.filter((owner) => owner !== null).length;
      item.activeColour = nextColour(item, colour);
      item.gameOver = players >= 2 && item.consecutivePasses >= players;
      item.score = item.gameOver ? scoreGoArea(item) : null;
    } else if (request.body.action === "move" || request.body.action === "suggest") {
      const { x, y } = request.body;
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return reply.code(400).send({ error: "that intersection is not on the board" });
      const applied = applyGoMove(item, colour, { x: x as number, y: y as number });
      if (!applied.ok) return reply.code(409).send({ error: moveRefusal(applied.reason) });
      item.stones = applied.stones; item.previousPosition = applied.previousPosition;
      item.liftedColour = null; item.turnActor = null; item.score = null; item.moveNumber += 1; item.consecutivePasses = 0;
      item.activeColour = nextColour(item, colour);
    } else return reply.code(400).send({ error: "action must be move, pass, or suggest" });
    options.items.save(room, item, session.username); publish(room, session.username);
    return reply.send({ item, ...(suggestion ? { suggestion } : {}) });
  });
}

function nextColour(item: RoomItem, from: number): number {
  const assigned = item.seats.map((seat, index) => seat ? index : -1).filter((index) => index >= 0);
  const candidates = assigned.length ? assigned : item.colours.map((_, index) => index);
  const after = candidates.find((index) => index > from);
  return after ?? candidates[0] ?? 0;
}

function moveRefusal(reason: "occupied" | "suicide" | "ko" | "finished"): string {
  switch (reason) {
    case "occupied": return "that intersection is occupied";
    case "suicide": return "that move would leave your group with no liberties";
    case "ko": return "that move repeats the previous board position (ko)";
    case "finished": return "this game has ended; resize the board to start a fresh game";
  }
}
