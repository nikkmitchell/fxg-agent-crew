import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout.js";
import { destinationFor } from "../space/destinations.js";
import { standFor } from "../../shared/panel-place.js";

/**
 * Which panels you have open.
 *
 * The interesting cases are all about the difference between a silence and a
 * decision: somebody who has never touched the settings gets the defaults, and
 * somebody who has closed a panel keeps it closed even when the defaults say
 * otherwise. A store that wrote everyone a full set of rows on first sight
 * would make those two indistinguishable within a day.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: testBlobRoot(),
    LOG_LEVEL: "silent",
  });
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
  return { ...built, as };
};

describe("the panel catalogue", () => {
  it("refuses to say anything to somebody not signed in", async () => {
    const { app } = boot();
    const response = await app.inject({ method: "GET", url: "/bff/space/panels" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("offers the defaults to somebody who has never chosen", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "GET",
      url: "/bff/space/panels",
      headers: { cookie: as("wren") },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.open).toEqual(DEFAULT_OPEN_PANELS);
    expect(body.panels.map((panel: { id: string }) => panel.id)).toEqual(Object.keys(STATIONS));
    await app.close();
  });

  it("includes the chat panel, which is why any of this exists", async () => {
    const { app, as } = boot();
    const body = (
      await app.inject({ method: "GET", url: "/bff/space/panels", headers: { cookie: as("wren") } })
    ).json();
    expect(body.panels.map((panel: { id: string }) => panel.id)).toContain("chat");
    expect(body.open).toContain("chat");
    await app.close();
  });
});

describe("choosing panels", () => {
  it("remembers a closed panel", async () => {
    const { app, as } = boot();
    const cookie = as("wren");
    const put = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/people",
      headers: { cookie },
      payload: { open: false },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().open).not.toContain("people");

    const again = await app.inject({
      method: "GET",
      url: "/bff/space/panels",
      headers: { cookie },
    });
    expect(again.json().open).not.toContain("people");
    await app.close();
  });

  it("carries one person's choice into everybody's room", async () => {
    /**
     * THIS TEST USED TO ASSERT THE OPPOSITE, and it was right to at the time —
     * "keeps one person's choice out of another person's room", because
     * panels.ts argued that what you have open is yours alone since nothing
     * anybody else sees depends on it. Nothing does. But Nikk, having used it:
     * "Now the enabled or dissabled boards/panels are not syned, we want this
     * to also be synced, have it the same as position and scale of boards."
     *
     * Inverted rather than deleted, so the reversal is visible in the history
     * instead of the old rule quietly disappearing.
     */
    const { app, as } = boot();
    await app.inject({
      method: "PUT",
      url: "/bff/space/panels/people",
      headers: { cookie: as("wren") },
      payload: { open: false },
    });
    const other = await app.inject({
      method: "GET",
      url: "/bff/space/panels",
      headers: { cookie: as("nikk") },
    });
    expect(other.json().open).not.toContain("people");
    await app.close();
  });

  it("refuses the last panel on everybody's behalf, not just the closer's", async () => {
    // The refusal existed before and protected one person's own room. Shared,
    // it protects a room full of people who are not looking at a settings
    // menu and would have no idea why the walls went bare.
    const { app, as } = boot();
    const catalogue = (await app.inject({
      method: "GET", url: "/bff/space/panels", headers: { cookie: as("wren") },
    })).json().open as string[];

    // Close everything but the last, as one person.
    for (const id of catalogue.slice(0, -1)) {
      const put = await app.inject({
        method: "PUT", url: `/bff/space/panels/${id}`,
        headers: { cookie: as("wren") }, payload: { open: false },
      });
      expect(put.statusCode, `closing ${id}`).toBe(200);
    }

    // Somebody ELSE now tries to close the one that is left.
    const last = catalogue[catalogue.length - 1];
    const refused = await app.inject({
      method: "PUT", url: `/bff/space/panels/${last}`,
      headers: { cookie: as("nikk") }, payload: { open: false },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/everybody/);

    // And the room still has it.
    const after = await app.inject({
      method: "GET", url: "/bff/space/panels", headers: { cookie: as("nikk") },
    });
    expect(after.json().open).toEqual([last]);
    await app.close();
  });

  it("keeps the panels in catalogue order, not the order they were toggled", async () => {
    const { app, as } = boot();
    const cookie = as("wren");
    for (const id of ["moodBoard", "chat"]) {
      await app.inject({
        method: "PUT",
        url: `/bff/space/panels/${id}`,
        headers: { cookie },
        payload: { open: false },
      });
      await app.inject({
        method: "PUT",
        url: `/bff/space/panels/${id}`,
        headers: { cookie },
        payload: { open: true },
      });
    }
    const body = (
      await app.inject({ method: "GET", url: "/bff/space/panels", headers: { cookie } })
    ).json();
    expect(body.open).toEqual(Object.keys(STATIONS));
    await app.close();
  });

  it("refuses to close the last one, and says why", async () => {
    const { app, as } = boot();
    const cookie = as("wren");
    const ids = Object.keys(STATIONS);
    for (const id of ids.slice(0, -1)) {
      const response = await app.inject({
        method: "PUT",
        url: `/bff/space/panels/${id}`,
        headers: { cookie },
        payload: { open: false },
      });
      expect(response.statusCode).toBe(200);
    }
    const last = await app.inject({
      method: "PUT",
      url: `/bff/space/panels/${ids[ids.length - 1]}`,
      headers: { cookie },
      payload: { open: false },
    });
    expect(last.statusCode).toBe(422);
    expect(last.json().error).toMatch(/last panel/);
    // And it is still open, rather than refused and closed anyway.
    const body = (
      await app.inject({ method: "GET", url: "/bff/space/panels", headers: { cookie } })
    ).json();
    expect(body.open).toEqual([ids[ids.length - 1]]);
    await app.close();
  });

  it("refuses a panel that does not exist rather than storing it", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/whiteboard",
      headers: { cookie: as("wren") },
      payload: { open: true },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatch(/no panel called/);
    await app.close();
  });

  it("refuses anything that is not a yes or a no", async () => {
    const { app, as } = boot();
    for (const open of ["true", 1, null]) {
      const response = await app.inject({
        method: "PUT",
        url: "/bff/space/panels/people",
        headers: { cookie: as("wren") },
        payload: { open },
      });
      expect(response.statusCode).toBe(400);
    }
    await app.close();
  });
});

describe("moving a panel", () => {
  const place = (x: number, y: number, z: number, rotationY = 0) => ({
    position: { x, y, z },
    rotationY,
  });

  it("refuses to move anything for somebody not signed in", async () => {
    const { app } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      payload: place(0, 1.6, 0),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("reports the untouched arc until somebody moves something", async () => {
    const { app, as } = boot();
    const body = (
      await app.inject({ method: "GET", url: "/bff/space/panels", headers: { cookie: as("wren") } })
    ).json();
    expect(body.places.map((p: { id: string }) => p.id)).toEqual(Object.keys(STATIONS));
    expect(body.places[1].position).toEqual(STATIONS[Object.keys(STATIONS)[1]].surface.position);
    await app.close();
  });

  it("moves it for EVERYONE, not just the person who moved it", async () => {
    const { app, as } = boot();
    const moved = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      headers: { cookie: as("wren") },
      payload: place(1.5, 2, -3, 0.4),
    });
    expect(moved.statusCode).toBe(200);

    // Somebody else entirely, who did not move it.
    const body = (
      await app.inject({ method: "GET", url: "/bff/space/panels", headers: { cookie: as("nikk") } })
    ).json();
    const board = body.places.find((p: { id: string }) => p.id === "taskBoard");
    expect(board.position).toEqual({ x: 1.5, y: 2, z: -3 });
    expect(board.rotationY).toBeCloseTo(0.4, 10);
    await app.close();
  });

  it("wraps a spun rotation rather than storing the winding", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/people/place",
      headers: { cookie: as("wren") },
      payload: place(0, 1.6, 0, 0.3 + Math.PI * 2 * 4),
    });
    expect(response.json().placement.rotationY).toBeCloseTo(0.3, 10);
    await app.close();
  });

  it("refuses a place nobody could read from, and says why", async () => {
    const { app, as } = boot();
    for (const [payload, why] of [
      [place(0, 0.1, 0), /too low/],
      [place(0, 40, 0), /above where anybody can read/],
      [place(500, 1.6, 0), /outside the room/],
    ] as const) {
      const response = await app.inject({
        method: "PUT",
        url: "/bff/space/panels/taskBoard/place",
        headers: { cookie: as("wren") },
        payload,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatch(why);
    }
    await app.close();
  });

  it("refuses a panel that does not exist", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/whiteboard/place",
      headers: { cookie: as("wren") },
      payload: place(0, 1.6, 0),
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it("refuses a body that is not a place", async () => {
    const { app, as } = boot();
    for (const payload of [{}, { position: { x: 1, y: 2 }, rotationY: 0 }, { position: { x: "1", y: 2, z: 3 }, rotationY: 0 }, { position: { x: 1, y: 2, z: 3 } }]) {
      const response = await app.inject({
        method: "PUT",
        url: "/bff/space/panels/taskBoard/place",
        headers: { cookie: as("wren") },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    await app.close();
  });
});

describe("an agent walks to where the panel actually is", () => {
  it("follows a moved board, rather than to where it used to be", () => {
    // THE CLAIM THIS ROOM MAKES is "that agent is at the board because it
    // touched a card". The moment somebody drags the board and the mapping
    // keeps sending people to the old spot, the claim is false — and it fails
    // in the worst way, because the label above their head still says
    // "commented on a card" while they stand in empty space.
    const row = {
      id: 1,
      actorId: "wren",
      action: "comment",
      entity: "task",
      entityId: "saha-1",
    };
    const untouched = destinationFor(row);
    expect(untouched?.at).toEqual(STATIONS.taskBoard.stand);

    const moved = { id: "taskBoard", position: { x: 6, y: 1.6, z: -4 }, rotationY: 0 };
    const after = destinationFor(row, { taskBoard: moved });
    expect(after?.at).toEqual(standFor(moved));
    expect(after?.facing).toBe(0);
    expect(after?.because).toBe(untouched?.because);
  });

  it("leaves the other panels where they are when one moves", () => {
    const row = { id: 2, actorId: "wren", action: "add", entity: "board_item", entityId: "b1" };
    const after = destinationFor(row, {
      taskBoard: { id: "taskBoard", position: { x: 8, y: 1.6, z: 8 }, rotationY: 0 },
    });
    expect(after?.at).toEqual(STATIONS.moodBoard.stand);
  });

  it("sends somebody to their own desk for a profile edit, moved panels or not", () => {
    const row = { id: 3, actorId: "wren", action: "update", entity: "profile", entityId: "wren" };
    const withMoves = destinationFor(row, {
      taskBoard: { id: "taskBoard", position: { x: 8, y: 1.6, z: 8 }, rotationY: 0 },
    });
    expect(withMoves?.at).toEqual(destinationFor(row)?.at);
  });
});

/**
 * How big a panel is.
 *
 * The bug these are here to stop coming back is one I shipped and then caught
 * in the browser: the size had a column, a shared rule and a refusal message,
 * and was silently dropped by the two pieces in between — the client did not
 * send it and the route did not read it. Everything looked right and nothing
 * changed size. So the round trip is what gets tested, not the rule on its own.
 */
describe("resizing a panel", () => {
  const sized = (scale: number | undefined) => ({
    position: { x: 0, y: 1.6, z: 0 },
    rotationY: 0,
    ...(scale !== undefined ? { scale } : {}),
  });

  const placesOf = async (app: ReturnType<typeof boot>["app"], cookie: string) => {
    const response = await app.inject({
      method: "GET",
      url: "/bff/space/panels",
      headers: { cookie },
    });
    return (JSON.parse(response.body) as { places: { id: string; scale?: number }[] }).places;
  };

  it("keeps the size it was given, and hands it back", async () => {
    const { app, as } = boot();
    const cookie = as("nikk");
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      headers: { cookie },
      payload: sized(1.6),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).placement.scale).toBeCloseTo(1.6, 6);

    const stored = (await placesOf(app, cookie)).find((place) => place.id === "taskBoard");
    expect(stored?.scale).toBeCloseTo(1.6, 6);
    await app.close();
  });

  it("is one size for everybody, because a panel is furniture", async () => {
    const { app, as } = boot();
    await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      headers: { cookie: as("nikk") },
      payload: sized(2),
    });
    const seen = (await placesOf(app, as("baiwei"))).find((place) => place.id === "taskBoard");
    expect(seen?.scale).toBeCloseTo(2, 6);
    await app.close();
  });

  it("a placement sent without a size is stored at its normal size", async () => {
    // An older tab dragging a panel sends no scale at all. That must mean
    // "leave it alone", not "this panel has no size".
    const { app, as } = boot();
    const cookie = as("nikk");
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      headers: { cookie },
      payload: sized(undefined),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).placement.scale).toBe(1);
    await app.close();
  });

  it("refuses a size nobody could read, and says why", async () => {
    const { app, as } = boot();
    for (const [scale, why] of [
      [0.05, /readable/],
      [9, /cover the panels behind/],
    ] as const) {
      const response = await app.inject({
        method: "PUT",
        url: "/bff/space/panels/taskBoard/place",
        headers: { cookie: as("nikk") },
        payload: sized(scale),
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error).toMatch(why);
    }
    await app.close();
  });

  it("refuses a size that is not a number rather than ignoring it", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/panels/taskBoard/place",
      headers: { cookie: as("nikk") },
      payload: { position: { x: 0, y: 1.6, z: 0 }, rotationY: 0, scale: "big" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
