import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildServer } from "../index.js";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { DEMAND_WINDOW_MS, STILL_TABS, stillsAreWanted } from "../space/stills.js";

/**
 * Pictures of the pages, for the headset.
 *
 * The endpoint that mints a render session creates one WITHOUT A PASSWORD, so
 * most of what is tested here is the guards on it. The rest is the thing that
 * keeps a headless browser from running on an idle box.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const boot = (stillsToken = "a-real-secret") => {
  const stillsRoot = mkdtempSync(resolve(tmpdir(), "stills-"));
  roots.push(stillsRoot);
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    STILLS_ROOT: stillsRoot,
    STILLS_TOKEN: stillsToken,
    LOG_LEVEL: "silent",
  });
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
  return { ...built, as, stillsRoot };
};

describe("minting a session for the renderer", () => {
  it("refuses without the secret", async () => {
    const { app } = boot();
    const response = await app.inject({ method: "POST", url: "/bff/space/render-session" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("refuses the wrong secret", async () => {
    const { app } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/render-session",
      headers: { "x-stills-token": "not-it" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("refuses EVERYTHING when no secret is configured", async () => {
    // An unconfigured deployment must not be one where the empty string works.
    const { app } = boot("");
    for (const token of ["", "anything"]) {
      const response = await app.inject({
        method: "POST",
        url: "/bff/space/render-session",
        headers: { "x-stills-token": token },
      });
      expect(response.statusCode, `token ${JSON.stringify(token)}`).toBe(404);
    }
    await app.close();
  });

  it("says the same thing however you fail", async () => {
    // A different message per guard tells a prober which one they got past.
    const { app } = boot();
    const noSecret = await app.inject({ method: "POST", url: "/bff/space/render-session" });
    const wrongSecret = await app.inject({
      method: "POST",
      url: "/bff/space/render-session",
      headers: { "x-stills-token": "not-it" },
    });
    expect(noSecret.body).toBe(wrongSecret.body);
    expect(noSecret.statusCode).toBe(wrongSecret.statusCode);
    await app.close();
  });

  it("mints a session for an actor who can never appear in the room", async () => {
    const { app } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/render-session",
      headers: { "x-stills-token": "a-real-secret" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cookie).toMatch(/^fxg_sid=/);
    // The renderer is a browser, not a colleague. It must never be drawn.
    expect(NOT_A_PERSON.has("render")).toBe(true);
    await app.close();
  });
});

describe("serving a still", () => {
  it("refuses a signed-out reader", async () => {
    // The pictures are of pages a signed-out person may not see.
    const { app } = boot();
    const response = await app.inject({ method: "GET", url: "/bff/space/stills/board.png" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("refuses a tab that is not a panel", async () => {
    const { app, as } = boot();
    for (const tab of ["../../etc/passwd", "chat", "..%2F..%2Fsecret"]) {
      const response = await app.inject({
        method: "GET",
        url: `/bff/space/stills/${tab}.png`,
        headers: { cookie: as("nikk") },
      });
      expect([404, 400], `tab ${tab}`).toContain(response.statusCode);
    }
    await app.close();
  });

  it("says the picture is coming rather than pretending the panel is missing", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "GET",
      url: "/bff/space/stills/board.png",
      headers: { cookie: as("nikk") },
    });
    // 404 would read as "no such panel", which is a different and wrong thing.
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("NOT_RENDERED_YET");
    await app.close();
  });

  it("serves the picture with its age, and never lets it be cached", async () => {
    const { app, as, stillsRoot } = boot();
    writeFileSync(resolve(stillsRoot, "board.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const response = await app.inject({
      method: "GET",
      url: "/bff/space/stills/board.png",
      headers: { cookie: as("nikk") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    // A cached still is a stale board that looks current.
    expect(response.headers["cache-control"]).toBe("no-store");
    // Sent so the scene can say how old it is instead of implying it is live.
    expect(Number(response.headers["x-still-age-seconds"])).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});

describe("keeping a browser off an idle box", () => {
  it("does not want stills until somebody asks", () => {
    const { stillsRoot } = boot();
    expect(stillsAreWanted(stillsRoot)).toBe(false);
  });

  it("wants them once somebody asks, and stops wanting them later", async () => {
    const { app, as, stillsRoot } = boot();
    await app.inject({
      method: "GET",
      url: "/bff/space/stills/board.png",
      headers: { cookie: as("nikk") },
    });
    expect(stillsAreWanted(stillsRoot)).toBe(true);
    // The renderer must stand down again on its own; otherwise one visit keeps
    // Chrome running for as long as the box is up.
    expect(stillsAreWanted(stillsRoot, Date.now() + DEMAND_WINDOW_MS + 1)).toBe(false);
    await app.close();
  });

  it("serves a still even when it cannot record that anybody wanted it", async () => {
    // An unwritable stills directory is a degraded picture, not a broken page.
    // Pointing this at /opt — read-only under ProtectSystem=strict — turned
    // every request into a 500 in production.
    const { app, as, stillsRoot } = boot();
    writeFileSync(resolve(stillsRoot, "board.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    chmodSync(stillsRoot, 0o500);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/bff/space/stills/board.png",
        headers: { cookie: as("nikk") },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      chmodSync(stillsRoot, 0o700);
      await app.close();
    }
  });

  it("photographs exactly the panels, so the two cannot drift apart", () => {
    expect(STILL_TABS).toEqual(["board", "mood", "people"]);
  });
});
