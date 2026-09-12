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
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
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

  it("keeps one person's choice out of another person's room", async () => {
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
    expect(other.json().open).toContain("people");
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

    const moved = standFor({ id: "taskBoard", position: { x: 6, y: 1.6, z: -4 }, rotationY: 0 });
    const after = destinationFor(row, { taskBoard: moved });
    expect(after?.at).toEqual(moved);
    expect(after?.because).toBe(untouched?.because);
  });

  it("leaves the other panels where they are when one moves", () => {
    const row = { id: 2, actorId: "wren", action: "add", entity: "board_item", entityId: "b1" };
    const after = destinationFor(row, {
      taskBoard: { x: 99, y: 0, z: 99 },
    });
    expect(after?.at).toEqual(STATIONS.moodBoard.stand);
  });

  it("sends somebody to their own desk for a profile edit, moved panels or not", () => {
    const row = { id: 3, actorId: "wren", action: "update", entity: "profile", entityId: "wren" };
    const withMoves = destinationFor(row, { taskBoard: { x: 9, y: 0, z: 9 } });
    expect(withMoves?.at).toEqual(destinationFor(row)?.at);
  });
});
