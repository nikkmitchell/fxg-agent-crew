import { describe, it, expect } from "vitest";
import { buildServer } from "../index.js";
import { RoomItems } from "../space/items.js";
import { tempDir } from "./test-config.js";
import { defaultGameItem } from "../../shared/table-games.js";
describe("shared game tables", () => {
  it("persists seats and legal moves, rejects spectators/stale duplicates and isolates rooms", async () => {
    const { app, sessions, config, database } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("games-"),
      LOG_LEVEL: "silent",
    });
    try {
      const items = new RoomItems(database),
        item = defaultGameItem("game-one", "connect-four", "Alice");
      items.insert("saha.ing", item, "Alice");
      const cookies = Object.fromEntries(
        ["Alice", "Bob", "Spectator"].map((n) => [
          n,
          `${config.cookieName}=${sessions.create(n, "t", "human")}`,
        ]),
      );
      const act = (by: string, body: object) =>
        app.inject({
          method: "POST",
          url: "/bff/space/items/game-one/action",
          headers: { cookie: cookies[by] },
          payload: body,
        });
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
      const moved = await act("Alice", {
        action: "move",
        column: 0,
        revision: 2,
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().item.state.board[35]).toBe(1);
      expect(
        (await act("Alice", { action: "move", column: 0, revision: 2 }))
          .statusCode,
      ).toBe(409);
      expect(
        (await act("Alice", { action: "move", column: 1, revision: 3 }))
          .statusCode,
      ).toBe(403);
      expect(items.one("lobby", item.id)).toBeNull();
      expect(
        (await act("Alice", { action: "reset", revision: 3 })).json().item.state
          .board[35],
      ).toBe(1);
      const reset = await act("Bob", { action: "reset", revision: 4 });
      expect(reset.json().item.state.board.every((n: number) => n === 0)).toBe(
        true,
      );
      const read = await app.inject({
        method: "GET",
        url: "/bff/space/games",
        headers: { cookie: cookies.Alice },
      });
      expect(read.json().games[0].revision).toBe(5);
      expect(read.json().games[0].legalMoves).toHaveLength(7);
      expect(items.one("saha.ing", item.id)).toEqual(reset.json().item);
    } finally {
      await app.close();
    }
  });
  it("refuses malformed creation and keeps legal table placement through the existing item route", async () => {
    const { app, sessions, config } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("games-create-"),
      LOG_LEVEL: "silent",
    });
    try {
      const headers = {
        cookie: `${config.cookieName}=${sessions.create("Alice", "t", "human")}`,
      };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/bff/space/items",
            headers,
            payload: { kind: "game", game: "bad" },
          })
        ).statusCode,
      ).toBe(400);
      const added = await app.inject({
        method: "POST",
        url: "/bff/space/items",
        headers,
        payload: { kind: "game", game: "chess" },
      });
      expect(added.statusCode).toBe(201);
      const id = added.json().item.id;
      const p = { x: 1, y: 0.3, z: 2, rotationY: 0.5 };
      const placed = await app.inject({
        method: "PATCH",
        url: `/bff/space/items/${id}`,
        headers,
        payload: { position: p, revision: 0 },
      });
      expect(placed.json().item.position).toEqual(p);
      const removed = await app.inject({
        method: "DELETE",
        url: `/bff/space/items/${id}`,
        headers,
      });
      expect(removed.json().items).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
