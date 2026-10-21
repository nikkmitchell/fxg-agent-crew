import { describe, it, expect } from "vitest";
import { join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { MemorySessionStore } from "../session.js";
import { FinishedSpaces } from "../space/finished.js";
import { testConfig } from "./test-config.js";
import { RoomItems, registerRoomItemRoutes } from "../space/items.js";
import { tempDir } from "./test-config.js";
import type { ModuleRoomItem } from "../../shared/room-items.js";
const thing = (id = "game-one"): ModuleRoomItem => ({
  id,
  kind: "module",
  revision: 0,
  source: { space: "saha.ing", branch: "main", entry: "games-room" },
  name: "Games room",
  role: "space",
  view: "placed",
  position: { x: 0, y: 0, z: 3, rotationY: 0 },
  scale: 1,
  addedBy: "Alice",
});
function boot(path = ":memory:") {
  const config = testConfig(),
    database = openDatabase(path, DatabaseSync);
  const app = Fastify(),
    sessions = new MemorySessionStore(60000);
  app.register(cookie);
  app.addHook("onClose", async () => database.close());
  const manifests: Record<
    string,
    import("../../shared/table-games.js").GameSlots
  > = {
    "games-room": {
      "": "connect-four",
      left: "chess",
      right: "chess",
      root: "chess",
    },
  };
  let beforeDescribe: (() => Promise<void>) | undefined;
  const server = { app, sessions, config, database };
  const headers = (by = "Alice") => ({
    cookie: `${server.config.cookieName}=${server.sessions.create(by, "t", "human")}`,
  });
  const items = new RoomItems(server.database);
  const open = (id = "game-one", game = "connect-four") =>
    server.app.inject({
      method: "POST",
      url: `/bff/space/items/${encodeURIComponent(id)}/game`,
      headers: headers(),
      payload: { game },
    });
  const act = (by: string, change: object, id = "game-one") =>
    server.app.inject({
      method: "POST",
      url: `/bff/space/items/${encodeURIComponent(id)}/game/action`,
      headers: headers(by),
      payload: change,
    });
  registerRoomItemRoutes(app, {
    config,
    sessions,
    items,
    announce: () => {},
    locked: (room) => new FinishedSpaces(database).has(room),
    describeModule: async (_who, source) => {
      await beforeDescribe?.();
      return {
        name: "Games room",
        role: "space",
        games: manifests[source.entry],
      };
    },
  });
  return {
    ...server,
    items,
    headers,
    open,
    act,
    manifests,
    delayDescribe(fn: () => Promise<void>) {
      beforeDescribe = fn;
    },
  };
}
describe("game tables through Things", () => {
  it("keeps turns authoritative, rejects spectators and duplicate moves, and requires both players to reset", async () => {
    const { app, items, open, act, headers } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      expect((await open()).statusCode).toBe(201);
      expect(
        (await act("Alice", { action: "join", side: 1, revision: 0 }))
          .statusCode,
      ).toBe(200);
      expect(
        (await act("Bob", { action: "join", side: 1, revision: 1 })).statusCode,
      ).toBe(409);
      expect(
        (await act("Bob", { action: "join", side: 2, revision: 1 })).statusCode,
      ).toBe(200);
      expect(
        (await act("Spectator", { action: "move", column: 0, revision: 2 }))
          .statusCode,
      ).toBe(403);
      expect(
        (await act("Spectator", { action: "cancel-reset", revision: 2 }))
          .statusCode,
      ).toBe(403);
      const moved = await act("Alice", {
        action: "move",
        column: 0,
        revision: 2,
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().table.state.board[35]).toBe(1);
      expect(
        (await act("Alice", { action: "move", column: 0, revision: 2 }))
          .statusCode,
      ).toBe(409);
      expect(
        (await act("Alice", { action: "move", column: 1, revision: 3 }))
          .statusCode,
      ).toBe(403);
      expect(
        (await act("Alice", { action: "reset", revision: 3 })).json().table
          .state.board[35],
      ).toBe(1);
      expect(
        (await act("Alice", { action: "cancel-reset", revision: 4 })).json()
          .table.resetBy,
      ).toEqual([]);
      await act("Alice", { action: "reset", revision: 5 });
      const reset = await act("Bob", { action: "reset", revision: 6 });
      expect(reset.json().table.state.board.every((n: number) => n === 0)).toBe(
        true,
      );
      const read = await app.inject({
        url: "/bff/space/games",
        headers: headers(),
      });
      expect(read.json().games[0]).toMatchObject({
        id: "game-one",
        revision: 7,
        legalMoves: expect.any(Array),
      });
      expect(items.one("lobby", "game-one")).toBeNull();
    } finally {
      await app.close();
    }
  });
  it("independently composes child matches, rejects bad instances and retains matches when moved", async () => {
    const { app, items, open, act, headers } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      expect((await open("missing")).statusCode).toBe(404);
      expect((await open("game-one", "bad")).statusCode).toBe(400);
      expect((await open("game-one/left", "chess")).statusCode).toBe(201);
      expect((await open("game-one", "connect-four")).statusCode).toBe(201);
      expect((await open("game-one/root", "chess")).statusCode).toBe(201);
      expect((await open("game-one", "connect-four")).json().table.game).toBe(
        "connect-four",
      );
      expect((await open("game-one/right", "chess")).statusCode).toBe(201);
      expect((await open("game-one/left", "checkers")).statusCode).toBe(403);
      await act(
        "Alice",
        { action: "join", side: 1, revision: 0 },
        "game-one/left",
      );
      expect(
        (await open("game-one/right", "chess")).json().table.seats,
      ).toEqual([null, null]);
      const placed = await app.inject({
        method: "PATCH",
        url: "/bff/space/items/game-one",
        headers: headers(),
        payload: { position: { x: 1, y: 0.3, z: 2, rotationY: 0.5 } },
      });
      expect(placed.json().item.tableGames.left.seats[0]).toBe("Alice");
      expect(placed.json().item.kind).toBe("module");
      await app.inject({
        method: "DELETE",
        url: "/bff/space/items/game-one",
        headers: headers(),
      });
      expect((await open("game-one/left", "chess")).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/bff/space/items",
            headers: headers(),
            payload: { kind: "game", game: "chess" },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("restores a match from the durable room-item store after a server restart", async () => {
    const path = join(tempDir("game-restart-"), "room.sqlite");
    const first = boot(path);
    first.items.insert("saha.ing", thing(), "Alice");
    await first.open();
    await first.act("Alice", { action: "join", side: 1, revision: 0 });
    await first.act("Alice", { action: "move", column: 3, revision: 1 });
    await first.app.close();
    const second = boot(path);
    try {
      const read = await second.open();
      expect(read.statusCode).toBe(200);
      expect(read.json().table).toMatchObject({
        revision: 2,
        seats: ["Alice", null],
      });
      expect(read.json().table.state.board[38]).toBe(1);
    } finally {
      await second.app.close();
    }
  });
});

describe("game review regressions", () => {
  it("does not invalidate placement revisions when a match opens or advances", async () => {
    const { app, items, open, act, headers } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      await act("Alice", { action: "join", side: 1, revision: 0 });
      await act("Alice", { action: "move", column: 3, revision: 1 });
      const placed = await app.inject({
        method: "PATCH",
        url: "/bff/space/items/game-one",
        headers: headers(),
        payload: { revision: 0, position: { x: 1, y: 0, z: 2, rotationY: 0 } },
      });
      expect(placed.statusCode).toBe(200);
      expect(placed.json().item.tableGames[""].revision).toBe(2);
    } finally {
      await app.close();
    }
  });
  it("refuses hidden games on unrelated Things and undeclared child paths", async () => {
    const { app, items, open } = boot();
    try {
      const unrelated = thing("bookcase");
      unrelated.source.entry = "bookcase";
      items.insert("saha.ing", unrelated, "Alice");
      items.insert("saha.ing", thing(), "Alice");
      expect((await open("bookcase")).statusCode).toBe(403);
      expect((await open("game-one/hidden", "chess")).statusCode).toBe(403);
      expect(items.one("saha.ing", "bookcase")).not.toHaveProperty(
        "tableGames",
      );
    } finally {
      await app.close();
    }
  });
  it("lets either seated player resign between turns", async () => {
    const { app, items, open, act } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      await act("Alice", { action: "join", side: 1, revision: 0 });
      await act("Bob", { action: "join", side: 2, revision: 1 });
      const answer = await act("Bob", { action: "resign", revision: 2 });
      expect(answer.statusCode).toBe(200);
      expect(answer.json().table.state.winner).toBe(1);
    } finally {
      await app.close();
    }
  });
  it("quarantines corrupt chess history without breaking other games in the room", async () => {
    const { app, items, open, headers } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      await open("game-one/left", "chess");
      const saved = items.one("saha.ing", "game-one") as ModuleRoomItem;
      saved.tableGames!.left.state.moves = ["this is not SAN"];
      items.save("saha.ing", saved, "Alice");
      const answer = await app.inject({
        url: "/bff/space/games",
        headers: headers(),
      });
      expect(answer.statusCode).toBe(200);
      expect(answer.json().games).toHaveLength(1);
      expect(answer.json().games[0].game).toBe("connect-four");
    } finally {
      await app.close();
    }
  });
  it("preserves the existing finished-space write lock", async () => {
    const { app, items, open, act, database } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      const { FinishedSpaces } = await import("../space/finished.js");
      new FinishedSpaces(database).put({
        room: "saha.ing",
        title: "Finished",
        space: "saha.ing",
        branch: "main",
        entry: "games-room",
        deploy: "d1",
        by: "Alice",
        at: new Date().toISOString(),
      });
      expect((await open()).statusCode).toBe(403);
      expect(
        (await act("Alice", { action: "join", side: 1, revision: 0 }))
          .statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe("live manifest grants and frozen reads", () => {
  it("follows additions/removals without replacing a placed Thing", async () => {
    const { app, items, open, act, manifests, headers } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      expect((await open("game-one/new-board", "chess")).statusCode).toBe(403);
      manifests["games-room"]["new-board"] = "chess";
      expect((await open("game-one/new-board", "chess")).statusCode).toBe(201);
      delete manifests["games-room"]["new-board"];
      expect(
        (
          await act(
            "Alice",
            { action: "join", side: 1, revision: 0 },
            "game-one/new-board",
          )
        ).statusCode,
      ).toBe(403);
      expect((await open("game-one/new-board", "chess")).statusCode).toBe(403);
      const read = await app.inject({
        url: "/bff/space/items/game-one%2Fnew-board/game",
        headers: headers(),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().table.game).toBe("chess");
    } finally {
      await app.close();
    }
  });
  it("reads an existing match while finished writes stay locked", async () => {
    const { app, items, open, headers, database } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      new FinishedSpaces(database).put({
        room: "saha.ing",
        title: "Finished",
        space: "saha.ing",
        branch: "main",
        entry: "games-room",
        deploy: "d1",
        by: "Alice",
        at: new Date().toISOString(),
      });
      const read = await app.inject({
        url: "/bff/space/items/game-one/game",
        headers: headers(),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().table.game).toBe("connect-four");
      expect((await open()).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  it("does not resurrect a Thing removed during the async manifest check", async () => {
    const { app, items, open, act, delayDescribe } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      let started!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      delayDescribe(async () => {
        started();
        await held;
      });
      const pending = act("Alice", { action: "join", side: 1, revision: 0 });
      const running = pending.then((result) => result);
      await entered;
      items.remove("saha.ing", "game-one");
      release();
      expect((await running).statusCode).toBe(404);
      expect(items.one("saha.ing", "game-one")).toBeNull();
    } finally {
      await app.close();
    }
  });
  it("serializes same-revision commands after async manifest checks", async () => {
    const { app, items, open, act, delayDescribe } = boot();
    try {
      items.insert("saha.ing", thing(), "Alice");
      await open();
      delayDescribe(async () => {
        await Promise.resolve();
      });
      const replies = await Promise.all([
        act("Alice", { action: "join", side: 1, revision: 0 }),
        act("Bob", { action: "join", side: 2, revision: 0 }),
      ]);
      expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    } finally {
      await app.close();
    }
  });
});
