import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { Holds, TTL_MS } from "../space/holds.js";
import { RoomItems } from "../space/items.js";
import { tempDir } from "./test-config.js";

/**
 * Two people cannot move one thing at once.
 *
 * Nikk: "if somebody's already grabbed it then it's not movable". Before this,
 * a panel two people dragged ended wherever the LAST one let go, and the Go
 * table's carry was retried after "the table changed", so both carriers
 * succeeded and the later silently overwrote the earlier.
 */
describe("a hold", () => {
  const clock = () => {
    let now = 1_000;
    return { now: () => now, pass: (ms: number) => (now += ms) };
  };

  it("belongs to whoever took it first, and names them to anybody else", () => {
    const holds = new Holds();
    expect(holds.take("saha.ing", "panel:said", "Nikk2")).toEqual({ ok: true });
    expect(holds.take("saha.ing", "panel:said", "baiwei2")).toEqual({ heldBy: "Nikk2" });
  });

  it("is renewed by its holder rather than refused", () => {
    const holds = new Holds();
    holds.take("saha.ing", "panel:said", "Nikk2");
    expect(holds.take("saha.ing", "panel:said", "Nikk2")).toEqual({ ok: true });
  });

  /** The room folds names everywhere; re-spelling yourself is still you, and nobody else. */
  it("knows its holder however their name is cased", () => {
    const holds = new Holds();
    holds.take("saha.ing", "panel:said", "Nikk2");
    expect(holds.take("saha.ing", "panel:said", "nikk2")).toEqual({ ok: true });
    expect(holds.heldByOther("saha.ing", "panel:said", "NIKK2")).toBeNull();
  });

  it("is one thing in one room: another panel, or the same panel elsewhere, is free", () => {
    const holds = new Holds();
    holds.take("saha.ing", "panel:said", "Nikk2");
    expect(holds.take("saha.ing", "panel:taskBoard", "baiwei2")).toEqual({ ok: true });
    expect(holds.take("lobby", "panel:said", "baiwei2")).toEqual({ ok: true });
  });

  /**
   * A headset taken off mid-drag, a tab that crashed, a dropped connection:
   * none of them ever says "let go". A hold nobody renews must end by itself,
   * or one bad moment locks a panel for good.
   */
  it("ends by itself when nobody renews it", () => {
    const time = clock();
    const holds = new Holds(time.now);
    holds.take("saha.ing", "panel:said", "Nikk2");
    time.pass(TTL_MS - 1);
    expect(holds.holder("saha.ing", "panel:said")).toBe("Nikk2");
    time.pass(1);
    expect(holds.holder("saha.ing", "panel:said")).toBeNull();
    expect(holds.take("saha.ing", "panel:said", "baiwei2")).toEqual({ ok: true });
  });

  it("lasts as long as it keeps being renewed", () => {
    const time = clock();
    const holds = new Holds(time.now);
    holds.take("saha.ing", "panel:said", "Nikk2");
    for (let i = 0; i < 10; i++) {
      time.pass(TTL_MS / 2);
      holds.take("saha.ing", "panel:said", "Nikk2");
    }
    expect(holds.heldByOther("saha.ing", "panel:said", "baiwei2")).toBe("Nikk2");
  });

  it("is let go only by its holder", () => {
    const holds = new Holds();
    holds.take("saha.ing", "panel:said", "Nikk2");
    holds.release("saha.ing", "panel:said", "baiwei2");
    expect(holds.holder("saha.ing", "panel:said")).toBe("Nikk2");
    holds.release("saha.ing", "panel:said", "Nikk2");
    expect(holds.holder("saha.ing", "panel:said")).toBeNull();
  });
});

describe("the routes", () => {
  const boot = () => {
    const built = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("blobs-"),
      LOG_LEVEL: "silent",
    });
    const as = (username: string) => `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
    const hold = (cookie: string, thing: string, held: boolean) =>
      built.app.inject({ method: "POST", url: "/bff/space/holds", headers: { cookie }, payload: { thing, held } });
    const place = (cookie: string, id: string, x: number) =>
      built.app.inject({
        method: "PUT",
        url: `/bff/space/panels/${id}/place`,
        headers: { cookie },
        payload: { position: { x, y: 1.4, z: 2 }, rotationY: 0 },
      });
    return { ...built, as, hold, place };
  };

  it("refuses somebody not signed in", async () => {
    const { app } = boot();
    const response = await app.inject({ method: "POST", url: "/bff/space/holds", payload: { thing: "panel:said", held: true } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  /** A hold is room-scoped, so it waits behind the lobby's door like every other room call. */
  it("refuses somebody who has not entered a room yet", async () => {
    const { app, sessions, config, hold } = boot();
    const cookie = `${config.cookieName}=${sessions.createUnselected("Newcomer", "t")}`;
    const response = await hold(cookie, "panel:said", true);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("ROOM_NOT_SELECTED");
    await app.close();
  });

  it("refuses a hold on nothing in particular", async () => {
    const { app, as, hold } = boot();
    const nikk = as("Nikk2");
    for (const thing of ["said", "table:x", "panel:", 7]) {
      expect((await hold(nikk, thing as string, true)).statusCode).toBe(400);
    }
    expect(
      (await app.inject({ method: "POST", url: "/bff/space/holds", headers: { cookie: nikk }, payload: { thing: "panel:said" } }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });

  it("gives a panel to the first grab, and tells the second who has it", async () => {
    const { app, as, hold } = boot();
    expect((await hold(as("Nikk2"), "panel:said", true)).statusCode).toBe(200);
    const second = await hold(as("baiwei2"), "panel:said", true);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "HELD", heldBy: "Nikk2" });
    expect(second.json().error).toContain("Nikk2");
    await app.close();
  });

  /** The lock only means something if the WRITE honours it, not just the grab. */
  it("refuses to place a panel somebody else is holding, and lets the holder place it", async () => {
    const { app, as, hold, place } = boot();
    const nikk = as("Nikk2");
    const baiwei = as("baiwei2");
    await hold(nikk, "panel:said", true);

    const refused = await place(baiwei, "said", 3);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "HELD", heldBy: "Nikk2" });

    expect((await place(nikk, "said", -3)).statusCode).toBe(200);
    // Nobody else's panel is locked by it.
    expect((await place(baiwei, "taskBoard", 3)).statusCode).toBe(200);
    await app.close();
  });

  it("frees the panel the moment its holder lets go", async () => {
    const { app, as, hold, place } = boot();
    const nikk = as("Nikk2");
    const baiwei = as("baiwei2");
    await hold(nikk, "panel:said", true);
    expect((await hold(nikk, "panel:said", false)).statusCode).toBe(200);
    expect((await hold(baiwei, "panel:said", true)).statusCode).toBe(200);
    expect((await place(baiwei, "said", 3)).statusCode).toBe(200);
    await app.close();
  });

  it("does not let somebody else let go of your grip", async () => {
    const { app, as, hold, place } = boot();
    const nikk = as("Nikk2");
    const baiwei = as("baiwei2");
    await hold(nikk, "panel:said", true);
    expect((await hold(baiwei, "panel:said", false)).statusCode).toBe(200);
    expect((await place(baiwei, "said", 3)).statusCode).toBe(409);
    await app.close();
  });

  /**
   * THE GO TABLE, where Nikk found it. Its MOVE is guarded; its game is not,
   * because a person carrying the table is not holding the stones — somebody
   * across the room may still change the board type or reset the game.
   */
  it("refuses to move a table somebody else is carrying, but not to change its board", async () => {
    const { app, as, hold, database } = boot();
    const item = new RoomItems(database).add("saha.ing", "Nikk2");
    const nikk = as("Nikk2");
    const baiwei = as("baiwei2");
    const patch = (cookie: string, payload: object) =>
      app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie }, payload });
    const at = { x: 1, y: 0, z: 1, rotationY: 0 };

    await hold(nikk, `item:${item.id}`, true);
    const moved = await patch(baiwei, { position: at });
    expect(moved.statusCode).toBe(409);
    expect(moved.json()).toMatchObject({ code: "HELD", heldBy: "Nikk2" });
    expect((await patch(baiwei, { scale: 1.5 })).statusCode).toBe(409);

    expect((await patch(baiwei, { surface: "stone" })).statusCode).toBe(200);
    expect((await patch(nikk, { position: at })).statusCode).toBe(200);
    await app.close();
  });
});
