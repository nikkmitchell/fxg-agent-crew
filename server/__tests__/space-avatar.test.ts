import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", "agent")}`;
  return { ...built, as };
};

describe("agent avatar controls", () => {
  it("requires a session", async () => {
    const { app } = boot();
    const response = await app.inject({ method: "POST", url: "/bff/space/avatar", payload: { gesture: "wave" } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("changes only the authenticated actor", async () => {
    const { app, as, space } = boot();
    space.presence.animate("Plumbline", { mood: "neutral" });
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/avatar",
      headers: { cookie: as("Inkstone") },
      payload: { actorId: "Plumbline", mood: "happy", gesture: "wave" },
    });
    expect(response.statusCode).toBe(200);
    expect(space.presence.find("Inkstone")?.avatar).toMatchObject({ mood: "happy", gesture: "wave" });
    expect(space.presence.find("Inkstone")?.kind).toBe("agent");
    expect(space.presence.find("Plumbline")?.avatar.mood).toBe("neutral");
    await app.close();
  });

  it("refuses values the renderer does not understand", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/avatar",
      headers: { cookie: as("Inkstone") },
      payload: { gesture: "run arbitrary animation" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_AVATAR_CONTROL");
    await app.close();
  });
});
