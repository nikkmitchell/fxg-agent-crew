import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { RoomItems } from "../space/items.js";
import { tempDir } from "./test-config.js";

/**
 * Go from a terminal, with Go's own names: "D4", "white". The server reads them
 * with shared/go-text.ts, the rules the text board is drawn with, so a tool
 * (saha.py go) keeps no copy of which way the rows run or that there is no I.
 */
const ROOM = "saha.ing";

const boot = () => {
  const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: tempDir("go-name-"), LOG_LEVEL: "silent" });
  const table = new RoomItems(built.database).add(ROOM, "Moraine");
  const cookie = `${built.config.cookieName}=${built.sessions.create("Inkstone", "t", "agent")}`;
  const action = (payload: object) =>
    built.app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload });
  const go = (as?: string) =>
    built.app.inject({ method: "GET", url: `/bff/space/go${as ? `?as=${as}` : ""}`, headers: { cookie } });
  return { ...built, table, action, go };
};

describe("Go by name", () => {
  it("lists each table as text, with whose turn it is and whether it is yours", async () => {
    const { app, go, table } = boot();
    const black = (await go("black")).json().tables[0];
    expect(black).toMatchObject({ id: table.id, players: ["Black", "White"], toPlay: "Black", yourColour: "Black", yourTurn: true, ended: false });
    expect(black.text).toContain("to play: Black (X)");
    expect((await go("white")).json().tables[0]).toMatchObject({ yourColour: "White", yourTurn: false });
    expect((await go()).json().tables[0].yourTurn).toBeUndefined();
    await app.close();
  });

  it("plays a point named as Go names it, for a colour named in words", async () => {
    const { app, action, go, table } = boot();
    const played = await action({ action: "play", at: "D4", as: "black", revision: table.revision });
    expect(played.statusCode).toBe(200);
    const stone = played.json().item.stones[0];
    // D is the fourth column from the left (x 3); row 4 is fourth up from the near side.
    expect(stone).toMatchObject({ x: 3, y: table.size - 4, colour: 0 });
    const after = (await go("white")).json().tables[0];
    expect(after).toMatchObject({ toPlay: "White", yourTurn: true, stones: 1 });
    await app.close();
  });

  it("refuses a point that is not on the board, a colour not seated, and somebody else's turn, saying why", async () => {
    const { app, action } = boot();
    const offBoard = await action({ action: "play", at: "I5", as: "black" });
    expect(offBoard.statusCode).toBe(400);
    expect(offBoard.json().error).toMatch(/without I/);
    const unseated = await action({ action: "play", at: "D4", as: "coral" });
    expect(unseated.statusCode).toBe(400);
    expect(unseated.json().error).toMatch(/not seated.*Black, White/);
    expect((await action({ action: "play", at: "D4", as: "white" })).json().code).toBe("NOT_YOUR_TURN");
    expect((await action({ action: "pass", as: "white" })).json().code).toBe("NOT_YOUR_TURN");
    await app.close();
  });
});
