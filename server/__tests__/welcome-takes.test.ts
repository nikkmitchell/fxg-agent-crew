import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

const boot = () => {
  const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: tempDir("welcome-"), LOG_LEVEL: "silent" });
  const as = (name: string, kind: "human" | "agent" = "human") => `${built.config.cookieName}=${built.sessions.create(name, "t", kind)}`;
  return { ...built, as };
};

describe("the first-visit welcome", () => {
  it("says who may record one, and remembers per account who has seen it", async () => {
    const { app, as } = boot();
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Nikk2") } })).json()).toMatchObject({ canPublish: true, completed: false, takes: [] });
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Nikk2", "agent") } })).json().canPublish).toBe(false);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Visitor") } })).json().canPublish).toBe(false);

    await app.inject({ method: "POST", url: "/bff/space/welcome/complete", headers: { cookie: as("Visitor") } });
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Visitor") } })).json().completed).toBe(true);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Another") } })).json().completed).toBe(false);
    await app.close();
  });

  it("has one way to upload a recording: the clip routes, not the first version's single take", async () => {
    // The single-take routes wrote to their own table and mirrored into the clips
    // table; nothing has called them since clips replaced them (2026-09-28).
    const { app, as } = boot();
    const cookie = as("Nikk2");
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/bff/space/welcome", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome/Nikk2/take", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome/Nikk2/audio", headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });
});
