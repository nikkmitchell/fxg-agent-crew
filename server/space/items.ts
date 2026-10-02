import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply } from "fastify";
import { GO_COLOURS, GO_PLAYERS, GO_SURFACES, MODEL_HEIGHT, MODULE_SCALE, defaultGoItem, isFullView, isGoSize, isGoSurface, isModuleItem, parseModuleItem, parseRoomItem, type GoRoomItem, type ModuleRole, type ModuleRoomItem, type RoomItem } from "../../shared/room-items.js";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { Session, SessionStore } from "../session.js";
import { roomKey } from "../../shared/space-room.js";
import { placeGoStone } from "../../shared/go-rules.js";
import { CLOCK_PRESETS, clockNow, presetOf, settleTurn, startClock } from "../../shared/go-clock.js";
import { goTableEntityId } from "./destinations.js";
import { heldBySentence, type Holds } from "./holds.js";
import type { ModuleStates } from "./module-state.js";

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
  /** A Go table by id, or null for anything else (activity and seats only know tables). */
  goTable(room: string, id: string): GoRoomItem | null {
    const item = this.one(room, id);
    return item?.kind === "go" ? item : null;
  }
  add(room: string, by: string): GoRoomItem {
    const item = defaultGoItem(randomUUID(), this.all(room).length);
    this.insert(room, item, by);
    return item;
  }
  /** Something made elsewhere (a thing from a space's git), put into the room as it is. */
  insert(room: string, item: RoomItem, by: string): void {
    const now = new Date().toISOString();
    this.database.prepare("INSERT INTO space_items (id, kind, state_json, added_by, added_at, updated_by, updated_at, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.kind, JSON.stringify(item), by, now, by, now, roomKey(room));
  }
  /**
   * A move played through code, written to the business audit — which is what
   * the room reads to walk an agent to where it acted (activity.ts). Without it
   * an agent playing Go stayed at its desk and nobody could see who was
   * playing. Only `play`: a person placing a stone by hand is already there.
   */
  recordPlay(by: string, tableId: string, colour: number, point: { x: number; y: number }): void {
    this.database.prepare("INSERT INTO audit (at, actor_id, action, entity, entity_id, before, after) VALUES (?, ?, 'play', 'go_table', ?, NULL, ?)")
      .run(new Date().toISOString(), by, goTableEntityId(tableId, colour), JSON.stringify(point));
  }
  /** Take a table out of the room for good. True when there was one to take. */
  remove(room: string, id: string): boolean {
    const result = this.database.prepare("DELETE FROM space_items WHERE room = ? AND id = ?").run(roomKey(room), id);
    return Number(result.changes) > 0;
  }
  save(room: string, item: RoomItem, by: string): void {
    this.database.prepare("UPDATE space_items SET state_json = ?, updated_by = ?, updated_at = ? WHERE room = ? AND id = ?")
      .run(JSON.stringify(item), by, new Date().toISOString(), roomKey(room), item.id);
  }
}

export type ItemActionBody = { action?: unknown; x?: unknown; y?: unknown; hand?: unknown; colour?: unknown; revision?: unknown };
export type ItemActionAnswer = { status: number; payload: Record<string, unknown> };

export function registerRoomItemRoutes(app: FastifyInstance, options: {
  config: Config; sessions: SessionStore; items: RoomItems; announce: (room: string, items: RoomItem[], by: string) => void;
  /** Who is carrying which item; moving or resizing one somebody else holds is refused. */
  holds?: Holds;
  /**
   * What a space's manifest says an entry is, on the branch's live deploy, if
   * this person may use that space (server/spaces/routes.ts, describeModule).
   */
  describeModule?: (who: { username: string; token: string }, source: { space: string; branch: string; entry: string }) => Promise<{ name: string; role: ModuleRole } | { status: number; error: string }>;
  /** The shared values of things from spaces (module-state.ts): read when a copy starts, forgotten with the item. */
  moduleStates?: ModuleStates;
}) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const publish = (room: string, by: string) => { const items = options.items.all(room); options.announce(room, items, by); return items; };
  app.get("/bff/space/items", async (request, reply) => {
    const session = requireSession(request, reply); return session ? reply.send({ items: options.items.all(spaceRoomOf(session)) }) : reply;
  });
  app.post<{ Body: { kind?: unknown; source?: unknown; view?: unknown; position?: unknown; scale?: unknown } }>("/bff/space/items", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    if (request.body?.kind === "module") return addModule(request.body, session, reply);
    if (request.body?.kind !== "go") return reply.code(400).send({ code: "BAD_KIND", error: "a room item is a Go table, or a module from a space" });
    const room = spaceRoomOf(session); const item = options.items.add(room, session.username); publish(room, session.username); return reply.code(201).send({ item });
  });

  /** What a thing from a space has decided so far, for a copy that is starting. */
  app.get<{ Params: { id: string } }>("/bff/space/items/:id/state", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session);
    const item = options.items.one(room, request.params.id);
    if (!item || item.kind !== "module") return reply.code(404).send({ error: "no such thing from a space in this room" });
    return reply.header("cache-control", "no-store").send({ state: options.moduleStates?.get(room, item.id) ?? {} });
  });

  /** A position as the routes accept it: within the room, and within one turn. */
  const readPosition = (raw: unknown): ModuleRoomItem["position"] | null => {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Record<string, unknown>;
    if (![p.x, p.y, p.z, p.rotationY].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if (Math.abs(p.x as number) > 100 || Math.abs(p.z as number) > 100 || (p.y as number) < -0.5 || (p.y as number) > 5 || Math.abs(p.rotationY as number) > Math.PI * 2) return null;
    return { x: p.x as number, y: p.y as number, z: p.z as number, rotationY: p.rotationY as number };
  };
  const readScale = (raw: unknown): number | null =>
    typeof raw === "number" && Number.isFinite(raw) && raw >= MODULE_SCALE.min && raw <= MODULE_SCALE.max ? raw : null;

  /**
   * BRING A THING FROM A SPACE INTO THE ROOM (shared/room-items.ts, ModuleRoomItem).
   * The space's manifest says what it is: an item stands where it is put, an
   * environment surrounds the room, a space is a model unless asked full size.
   * A room has one thing all around it at a time: a new one replaces the last.
   */
  const MODULES_PER_ROOM = 40;
  const addModule = async (body: { source?: unknown; view?: unknown; position?: unknown; scale?: unknown }, session: Session, reply: FastifyReply) => {
    const room = spaceRoomOf(session);
    const given = (body.source ?? {}) as Record<string, unknown>;
    const draft = parseModuleItem({ id: "draft", kind: "module", source: given, role: "item", view: "placed", position: { x: 0, y: 0, z: 0, rotationY: 0 }, scale: 1 });
    if (!draft) return reply.code(400).send({ code: "BAD_SOURCE", error: "Say which space, branch and manifest entry: { source: { space, branch, entry } }." });
    if (!options.describeModule) return reply.code(503).send({ error: "Spaces are not available on this server." });
    if (options.items.all(room).filter(isModuleItem).length >= MODULES_PER_ROOM) return reply.code(422).send({ error: `A room holds ${MODULES_PER_ROOM} things from spaces; take one away first.` });
    const described = await options.describeModule({ username: session.username, token: session.token }, draft.source);
    if ("error" in described) return reply.code(described.status).send({ error: described.error });
    const view = described.role === "environment" ? "full" : described.role === "space" && body.view === "full" ? "full" : "placed";
    const position = view === "full" ? { x: 0, y: 0, z: 0, rotationY: 0 } : readPosition(body.position) ?? { x: 0, y: described.role === "space" ? MODEL_HEIGHT : 0, z: 1.5, rotationY: 0 };
    const scale = view === "full" ? 1 : readScale(body.scale) ?? (described.role === "space" ? MODULE_SCALE.model : 1);
    const item: ModuleRoomItem = { ...draft, id: randomUUID(), name: described.name, role: described.role, view, position, scale, addedBy: session.username };
    if (view === "full") for (const other of options.items.all(room).filter(isFullView)) options.items.remove(room, other.id);
    options.items.insert(room, item, session.username);
    publish(room, session.username);
    return reply.code(201).send({ item });
  };
  /**
   * DELETE THIS BOARD. Nikk (4452): "we need to adjust it so that you can
   * delete a go board, so in settings there should also be a button for delete
   * this board". The press is confirmed on the table (a second press); this is
   * the deletion itself.
   *
   * NOT WHILE SOMEBODY ELSE IS CARRYING IT: a table vanishing out of another
   * person's hands is the same surprise the grab lock exists to prevent.
   */
  app.delete<{ Params: { id: string } }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session);
    const item = options.items.one(room, request.params.id);
    if (!item) return reply.code(404).send({ error: "room item not found" });
    const heldBy = options.holds?.heldByOther(room, `item:${item.id}`, session.username);
    if (heldBy) return reply.code(409).send({ code: "HELD", heldBy, error: heldBySentence(heldBy) });
    options.items.remove(room, item.id);
    options.moduleStates?.forget(room, item.id);
    return reply.send({ items: publish(room, session.username) });
  });
  app.patch<{ Params: { id: string }; Body: { size?: unknown; addBowl?: unknown; players?: unknown; reset?: unknown; position?: unknown; scale?: unknown; revision?: unknown; deskVisible?: unknown; surface?: unknown; territoryShown?: unknown; clock?: unknown } }>("/bff/space/items/:id", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const room = spaceRoomOf(session); const item = options.items.one(room, request.params.id); if (!item) return reply.code(404).send({ error: "room item not found" });
    const change = request.body;
    if (change?.revision !== undefined && change.revision !== item.revision) {
      request.log.info({ tableChangeRefused: { who: session.username, table: item.id, sent: change.revision, now: item.revision } }, "table change refused: stale revision");
      return reply.code(409).send({ code: "TABLE_CHANGED", error: "The table changed. Try again." });
    }
    if (isModuleItem(item)) {
      // A thing from a space: where it stands, how big, and (a space) model or full size.
      const body = change as { position?: unknown; scale?: unknown; view?: unknown };
      if (body.position !== undefined || body.scale !== undefined) {
        const heldBy = options.holds?.heldByOther(room, `item:${item.id}`, session.username);
        if (heldBy) return reply.code(409).send({ code: "HELD", heldBy, error: heldBySentence(heldBy) });
      }
      if (body.view !== undefined) {
        if (item.role !== "space" || (body.view !== "placed" && body.view !== "full")) return reply.code(400).send({ error: "Only a space can be shown as a model or full size." });
        if (body.view !== item.view) {
          item.view = body.view;
          if (item.view === "full") {
            for (const other of options.items.all(room).filter(isFullView)) if (other.id !== item.id) options.items.remove(room, other.id);
            item.position = { x: 0, y: 0, z: 0, rotationY: 0 };
            item.scale = 1;
          } else {
            item.position = { x: 0, y: MODEL_HEIGHT, z: 1.5, rotationY: 0 };
            item.scale = MODULE_SCALE.model;
          }
        }
      }
      if (item.view === "placed") {
        if (body.position !== undefined) {
          const position = readPosition(body.position);
          if (!position) return reply.code(400).send({ error: "Keep x/z within 100 m, height offset between −0.5 and 5 m, and rotation within one turn." });
          item.position = position;
        }
        if (body.scale !== undefined) {
          const scale = readScale(body.scale);
          if (scale === null) return reply.code(400).send({ error: `Scale must be between ${MODULE_SCALE.min} and ${MODULE_SCALE.max}.` });
          item.scale = scale;
        }
      }
      item.revision++;
      options.items.save(room, item, session.username);
      publish(room, session.username);
      return reply.send({ item });
    }
    if (change?.deskVisible !== undefined) {
      if (typeof change.deskVisible !== "boolean") return reply.code(400).send({ error: "Desk visibility must be true or false." });
      item.deskVisible = change.deskVisible;
    }
    if (change?.territoryShown !== undefined) {
      // Only what is drawn: allowed mid-game, with a stone in the air, after the end.
      if (typeof change.territoryShown !== "boolean") return reply.code(400).send({ error: "Showing territory must be true or false." });
      item.territoryShown = change.territoryShown;
    }
    if (change?.clock !== undefined) {
      /**
       * THE TIMER (Nikk 4826): a preset number, 0 for none. Starting one fills
       * every bank and starts the current turn now; choosing none removes it.
       */
      if (!Number.isInteger(change.clock) || (change.clock as number) < 0 || (change.clock as number) >= CLOCK_PRESETS.length)
        return reply.code(400).send({ error: `clock must be a preset from 0 (off) to ${CLOCK_PRESETS.length - 1}` });
      item.clock = startClock(change.clock as number, item.colours.length, Date.now());
    }
    if (change?.surface !== undefined) {
      // Only how the board looks — allowed mid-game and with a stone in the air.
      if (!isGoSurface(change.surface)) return reply.code(400).send({ error: `Board type must be one of: ${GO_SURFACES.join(", ")}.` });
      item.surface = change.surface;
    }
    if (change?.position !== undefined || change?.scale !== undefined) {
      // A REFUSED MOVE IS LOGGED, with why: from inside a headset a refusal is
      // just the table jumping back, and Nikk (5126) could only ask whether
      // somebody else was moving it.
      const refuse = (why: string, body: Record<string, unknown>) => {
        request.log.info({ tableMoveRefused: { who: session.username, table: item.id, why } }, "table move refused");
        return reply.code(409).send(body);
      };
      if (item.liftedColour !== null) return refuse("stone in flight", { error: "Place or return the flying stone before moving the table." });
      // Only the MOVE is guarded: the game, the board type and the players are
      // not what a person carrying the table has in their hands.
      const heldBy = options.holds?.heldByOther(room, `item:${item.id}`, session.username);
      if (heldBy) return refuse(`held by ${heldBy}`, { code: "HELD", heldBy, error: heldBySentence(heldBy) });
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
        item.size = request.body.size; item.stones = []; item.captures = []; item.ko = null; item.timedOut = null;
        item.clock = item.clock ? startClock(presetOf(item.clock), item.colours.length, Date.now()) : null;
        item.liftedColour = null; item.carrier = null; item.activeColour = 0;
        item.passes = 0; item.ended = false;
      }
    }
    if (request.body?.addBowl === true) {
      if (item.colours.length >= GO_COLOURS.length) return reply.code(422).send({ error: "every available bowl colour is already here" });
      item.colours.push(GO_COLOURS[item.colours.length]);
      item.passes = 0;
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
      item.clock = item.clock ? startClock(presetOf(item.clock), wanted, Date.now()) : null;
      item.stones = item.stones.filter((stone) => stone.colour < wanted);
      // A capture is a STONE that was taken, carrying both whose it was and
      // who took it. Both have to still be at the table for it to mean
      // anything, so a leaving player takes their own captures and the ones
      // made against them.
      item.captures = item.captures.filter((taken) => taken.colour < wanted && taken.by < wanted);
      if (item.activeColour >= wanted) item.activeColour = 0;
      item.carrier = null;
      // A new turn order: passes counted against the old one no longer mean "everybody".
      item.passes = 0;
    }
    /** Take the stones off and give the turn back to the first player. */
    if (request.body?.reset === true) {
      item.stones = []; item.captures = []; item.ko = null; item.timedOut = null;
        item.clock = item.clock ? startClock(presetOf(item.clock), item.colours.length, Date.now()) : null;
      item.liftedColour = null; item.carrier = null; item.activeColour = 0;
      item.passes = 0; item.ended = false;
    }
    item.revision++;
    options.items.save(room, item, session.username); publish(room, session.username); return reply.send({ item });
  });
  /**
   * ONE MOVE AT A TABLE, whichever way it arrived. The web route and the room
   * socket (Nikk 5026: moves stalled on a bad connection while the socket kept
   * flowing) both call this, so the checks, the revision and the save are
   * the same code and cannot drift apart.
   */
  const act = (room: string, username: string, id: string, body: ItemActionBody): ItemActionAnswer => {
    const answer = (status: number, payload: Record<string, unknown>): ItemActionAnswer => ({ status, payload });
    const item = options.items.one(room, id); if (!item) return answer(404, { error: "room item not found" });
    // Moves and stones are the Go table's; a thing from a space acts through its own code.
    if (item.kind !== "go") return answer(400, { code: "NOT_A_GAME", error: "Only a Go table takes moves." });
    if (body.revision !== undefined && body.revision !== item.revision) return answer(409, { code: "TABLE_CHANGED", error: "The table changed. Try again." });
    // Recorded only AFTER the table is saved: the room walks an agent to its
    // seat on this row, and must never do that for a move that did not happen.
    let played: { colour: number; x: number; y: number } | null = null;
    /**
     * THE GAME IS OVER once every seated colour has passed in turn (Nikk 4504).
     * No stone may be lifted, placed or played and nobody may pass again until
     * the board is cleared; the count stays on the table for everybody to read.
     * `return` is still allowed, so a stone somebody was holding can go home.
     */
    /**
     * OUT OF TIME. The clock does not tick on the server; it is settled here,
     * when anybody touches the table. A player past their free seconds with an
     * empty bank has lost on time, and the game ends before anything else.
     * `clock` is an action that does only this, sent by a table that has seen
     * the time run out.
     */
    const mover = item.activeColour;
    if (item.clock && !item.ended && clockNow(item.clock, mover, Date.now()).flagged) {
      item.ended = true; item.timedOut = mover; item.liftedColour = null; item.carrier = null;
      item.revision++;
      options.items.save(room, item, username); publish(room, username);
      return answer(409, { code: "OUT_OF_TIME", error: "Out of time: the game is over.", item });
    }
    if (body.action === "clock") return answer(200, { item });
    const over = item.timedOut !== null ? "The game is over: a player ran out of time. Clear the stones in the table's settings to start a new one." : "The game is over: everybody passed. Clear the stones in the table's settings to start a new one.";
    if (item.ended && ["lift", "place", "play", "pass"].includes(body.action as string)) {
      return answer(409, { code: "GAME_OVER", error: over });
    }
    if (body.action === "lift") {
      if (item.liftedColour !== null) return answer(409, { error: "A stone is already in flight. Place it or return it first." });
      if (body.colour !== undefined && body.colour !== item.activeColour) return answer(409, { error: "It is the glowing bowl's turn." });
      if (body.hand !== undefined && body.hand !== null && body.hand !== "left" && body.hand !== "right") return answer(400, { error: "Unknown hand." });
      if (body.hand && options.items.all(room).some((table) => table.kind === "go" && table.carrier?.by === username && table.carrier.hand === body.hand)) return answer(409, { error: "That hand is already carrying a stone at another table." });
      item.liftedColour = item.activeColour;
      item.carrier = { by: username, hand: (body.hand as "left" | "right" | null) ?? null };
    }
    else if (body.action === "place") {
      const { x, y } = body;
      if (item.liftedColour !== item.activeColour) return answer(409, { error: "lift the glowing stone first" });
      if (item.carrier && item.carrier.by !== username) return answer(409, { error: `${item.carrier.by} is carrying this stone.` });
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return answer(400, { error: "that intersection is not on the board" });
      const move = placeGoStone(item.stones, item.size, { id: randomUUID(), x: x as number, y: y as number, colour: item.activeColour }, item.ko);
      if ("error" in move) return answer(409, { error: move.error });
      item.stones = move.stones;
      item.captures.push(...move.captured.map((stone) => ({ ...stone, by: item.activeColour })));
      item.ko = move.ko;
      item.liftedColour = null; item.carrier = null; item.activeColour = (item.activeColour + 1) % item.colours.length;
      item.passes = 0;
      if (item.clock) item.clock = settleTurn(item.clock, mover, Date.now());
    } else if (body.action === "play") {
      // A whole move in one request, for agents and their programs playing
      // through code (tools/go.mts). Lift-then-place is two requests with a
      // stone in the air between them, and a program that dies in between
      // leaves it hanging over everybody's game. This names the colour it is
      // playing, so it can never play somebody else's turn by being quick.
      const { x, y, colour } = body;
      if (item.liftedColour !== null) return answer(409, { error: `${item.carrier?.by ?? "Somebody"} is carrying a stone. Wait for it to land.` });
      if (!Number.isInteger(colour) || (colour as number) < 0 || (colour as number) >= item.colours.length)
        return answer(400, { error: "Say which colour you are playing: colour is the bowl's number, 0 for the first." });
      if (colour !== item.activeColour) return answer(409, { code: "NOT_YOUR_TURN", error: "It is not that colour's turn." });
      if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= item.size || (y as number) >= item.size)
        return answer(400, { error: "that intersection is not on the board" });
      const move = placeGoStone(item.stones, item.size, { id: randomUUID(), x: x as number, y: y as number, colour: item.activeColour }, item.ko);
      if ("error" in move) return answer(409, { error: move.error });
      item.stones = move.stones;
      item.captures.push(...move.captured.map((stone) => ({ ...stone, by: item.activeColour })));
      item.ko = move.ko;
      item.activeColour = (item.activeColour + 1) % item.colours.length;
      item.passes = 0;
      if (item.clock) item.clock = settleTurn(item.clock, mover, Date.now());
      played = { colour: colour as number, x: x as number, y: y as number };
    } else if (body.action === "pass") {
      /**
       * PASS: the turn goes on without a stone. When every seated colour has
       * passed one after another, the game ends and the board is counted.
       *
       * Named by colour, like `play`, so a pass cannot land on somebody else's
       * turn by arriving late; a person at the table, whose only pass button is
       * at the bowl whose turn it is, may leave it out.
       */
      const { colour } = body;
      if (item.liftedColour !== null) return answer(409, { error: `${item.carrier?.by ?? "Somebody"} is holding a stone. Put it down or return it before passing.` });
      if (colour !== undefined && colour !== item.activeColour) return answer(409, { code: "NOT_YOUR_TURN", error: "It is not that colour's turn." });
      // NOT BEFORE THE FIRST STONE. Baiwei (4555): after CLEAR STONES both
      // sides could pass at once and "end" a game nobody had played. The
      // rules allow it; nobody at this table means it.
      if (item.stones.length === 0 && item.captures.length === 0) {
        return answer(409, { code: "NOTHING_PLAYED", error: "Play a stone first: there is no game to pass in yet." });
      }
      item.passes += 1;
      if (item.clock) item.clock = settleTurn(item.clock, mover, Date.now());
      item.ko = null; // a pass opens a ko point
      item.activeColour = (item.activeColour + 1) % item.colours.length;
      if (item.passes >= item.colours.length) item.ended = true;
    } else if (body.action === "return") {
      // Deliberate recovery for a disconnected carrier; never steals on incidental contact.
      item.liftedColour = null; item.carrier = null;
    } else return answer(400, { error: "action must be lift, place, play, pass or return" });
    item.revision++;
    options.items.save(room, item, username);
    if (played) options.items.recordPlay(username, item.id, played.colour, played);
    publish(room, username); return answer(200, { item });
  };
  app.post<{ Params: { id: string }; Body: ItemActionBody }>("/bff/space/items/:id/action", async (request, reply) => {
    const session = requireSession(request, reply); if (!session) return reply;
    const { status, payload } = act(spaceRoomOf(session), session.username, request.params.id, request.body ?? {});
    return reply.code(status).send(payload);
  });
  return { act };
}
