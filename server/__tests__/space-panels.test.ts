import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { DEFAULT_OPEN_PANELS, STATIONS } from "../../shared/space-layout.js";

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
