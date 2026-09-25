import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { GO_PLAYERS } from "../../shared/room-items.js";

/**
 * The Go table's own settings, and where it stands.
 *
 * Nikk: "make the settings for board grid size and number of players to be a
 * settings button on the go board... as well as reset it and so on", and
 * "(now go board movement settings are just buttons which is super weird)".
 *
 * The interesting cases here are the ones that could leave a game in a state
 * nobody could play: taking a player away while their stones are on the board,
 * and taking away the player whose turn it is.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const as = (username: string) => `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
  return { ...built, as };
};

const addTable = async (app: ReturnType<typeof boot>["app"], cookie: string) => {
  const made = await app.inject({ method: "POST", url: "/bff/space/items", headers: { cookie }, payload: { kind: "go" } });
  expect(made.statusCode).toBe(201);
  return made.json().item as { id: string };
};

const patch = (app: ReturnType<typeof boot>["app"], cookie: string, id: string, body: unknown) =>
  app.inject({ method: "PATCH", url: `/bff/space/items/${id}`, headers: { cookie }, payload: body as object });

describe("how many are playing", () => {
  it("adds seats and takes them away again", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);

    const more = await patch(app, cookie, table.id, { players: 5 });
    expect(more.statusCode).toBe(200);
    expect(more.json().item.colours).toHaveLength(5);

    // The thing `addBowl` could never do.
    const fewer = await patch(app, cookie, table.id, { players: 3 });
    expect(fewer.statusCode).toBe(200);
    expect(fewer.json().item.colours).toHaveLength(3);
    await app.close();
  });

  it("TAKES A LEAVING PLAYER'S STONES WITH THEM", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await patch(app, cookie, table.id, { players: 4 });

    // Put a stone down for each of the four.
    for (let colour = 0; colour < 4; colour += 1) {
      await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
      const placed = await app.inject({
        method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie },
        payload: { action: "place", x: colour, y: 0 },
      });
      expect(placed.statusCode).toBe(200);
    }

    const fewer = await patch(app, cookie, table.id, { players: 2 });
    const item = fewer.json().item;
    expect(item.colours).toHaveLength(2);
    // A stone in a colour nobody is holding is a stone nobody can account for.
    expect(item.stones.every((stone: { colour: number }) => stone.colour < 2)).toBe(true);
    expect(item.stones).toHaveLength(2);
    await app.close();
  });

  it("does not leave the turn with a seat that is gone", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await patch(app, cookie, table.id, { players: 6 });
    // Step the turn along to the fifth player, then seat only two.
    for (let n = 0; n < 4; n += 1) {
      await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
      await app.inject({
        method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie },
        payload: { action: "place", x: n, y: 1 },
      });
    }
    const fewer = await patch(app, cookie, table.id, { players: 2 });
    const item = fewer.json().item;
    expect(item.activeColour).toBeLessThan(2);
    expect(item.liftedColour === null || item.liftedColour < 2).toBe(true);
    await app.close();
  });

  it("refuses a seating nobody could tell apart", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    expect((await patch(app, cookie, table.id, { players: 1 })).statusCode).toBe(400);
    expect((await patch(app, cookie, table.id, { players: GO_PLAYERS.max + 1 })).statusCode).toBe(400);
    expect((await patch(app, cookie, table.id, { players: 2.5 })).statusCode).toBe(400);
    await app.close();
  });
});

describe("clearing the board", () => {
  it("takes the stones off and gives the turn back to the first player", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
    await app.inject({
      method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie },
      payload: { action: "place", x: 2, y: 2 },
    });

    const cleared = await patch(app, cookie, table.id, { reset: true });
    const item = cleared.json().item;
    expect(item.stones).toEqual([]);
    expect(item.activeColour).toBe(0);
    expect(item.liftedColour).toBeNull();
    // Clearing is not reseating: the players stay.
    expect(item.colours).toHaveLength(2);
    await app.close();
  });

  it("leaves the board alone when nobody asked", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
    await app.inject({
      method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie },
      payload: { action: "place", x: 2, y: 2 },
    });
    const untouched = await patch(app, cookie, table.id, { reset: false });
    expect(untouched.json().item.stones).toHaveLength(1);
    await app.close();
  });
});

describe("where the table stands", () => {
  /**
   * These rules are MORAINE'S, not mine. We rebuilt the Go table at the same
   * time without knowing; theirs shipped first and carries x, y, z, rotationY,
   * a scale and a revision, so I dropped my own x/z-only placement rather than
   * keep two answers. What is still mine here is the gesture that writes it —
   * carrying the table on the pointer ray instead of nudging it with X/Y/Z
   * buttons — so the contract it writes through is worth holding down.
   */
  it("moves it, and remembers", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    const moved = await patch(app, cookie, table.id, { position: { x: 2.5, y: 0.2, z: -3, rotationY: 0.4 } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().item.position).toEqual({ x: 2.5, y: expect.closeTo(0.2, 9), z: -3, rotationY: expect.closeTo(0.4, 9) });

    const again = await app.inject({ method: "GET", url: "/bff/space/items", headers: { cookie } });
    expect(again.json().items[0].position.x).toBeCloseTo(2.5, 9);
    await app.close();
  });

  it("refuses a height nobody could play at, and says so", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    const refused = await patch(app, cookie, table.id, { position: { x: 0, y: 40, z: 0, rotationY: 0 } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/height offset/);
    await app.close();
  });

  it("refuses a position that is not a position", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    for (const position of [{ x: "2", y: 0, z: 0, rotationY: 0 }, { x: 1 }, { x: Number.NaN, y: 0, z: 0, rotationY: 0 }]) {
      expect((await patch(app, cookie, table.id, { position })).statusCode).toBe(400);
    }
    await app.close();
  });

  it("WILL NOT MOVE THE TABLE OUT FROM UNDER A STONE IN THE AIR", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
    const refused = await patch(app, cookie, table.id, { position: { x: 1, y: 0, z: 1, rotationY: 0 } });
    expect(refused.statusCode).toBe(409);
    await app.close();
  });

  it("keeps the stones where they were when the table is moved", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    await app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: { action: "lift" } });
    await app.inject({
      method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie },
      payload: { action: "place", x: 3, y: 3 },
    });
    const moved = await patch(app, cookie, table.id, { position: { x: 1, y: 0, z: 1, rotationY: 0 } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().item.stones).toMatchObject([{ x: 3, y: 3, colour: 0 }]);
    await app.close();
  });
});

/**
 * Ko, through the server (Moraine's review of 19e5657): refused by BOTH ways a
 * stone is played, direct `play` and lift-then-`place`, and remembered on the
 * table between requests.
 */
describe("ko at the table", () => {
  it("refuses the immediate retake by play and by place, and allows it once play has moved on", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const table = await addTable(app, cookie);
    expect((await patch(app, cookie, table.id, { size: 5 })).statusCode).toBe(200);
    const act = (body: object) =>
      app.inject({ method: "POST", url: `/bff/space/items/${table.id}/action`, headers: { cookie }, payload: body });
    const play = (x: number, y: number, colour: number) => act({ action: "play", x, y, colour });

    // Black surrounds (1,1) on three sides, White surrounds (2,1); White then
    // steps into (1,1), and Black takes it from (2,1): a ko at (1,1).
    for (const [x, y, c] of [[1, 0, 0], [2, 0, 1], [0, 1, 0], [3, 1, 1], [1, 2, 0], [2, 2, 1], [4, 4, 0], [1, 1, 1]] as const) {
      expect((await play(x, y, c)).statusCode, `${x},${y}`).toBe(200);
    }
    const take = await play(2, 1, 0);
    expect(take.statusCode).toBe(200);
    expect(take.json().item.ko).toEqual({ x: 1, y: 1 });

    const direct = await play(1, 1, 1);
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error).toMatch(/Ko/);

    expect((await act({ action: "lift", colour: 1 })).statusCode).toBe(200);
    const placed = await act({ action: "place", x: 1, y: 1 });
    expect(placed.statusCode).toBe(409);
    expect(placed.json().error).toMatch(/Ko/);
    expect((await act({ action: "place", x: 4, y: 0 })).statusCode).toBe(200); // White plays elsewhere

    expect((await play(4, 2, 0)).statusCode).toBe(200); // Black elsewhere
    expect((await play(1, 1, 1)).statusCode).toBe(200); // now the retake is allowed
    await app.close();
  });
});
