import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

const boot = () => {
  const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: tempDir("welcome-"), LOG_LEVEL: "silent" });
  const as = (name: string, kind: "human" | "agent" = "human") => `${built.config.cookieName}=${built.sessions.create(name, "t", kind)}`;
  return { ...built, as };
};
const pose = { p: { x: 0, y: 1, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } };
const frame = (t: number) => ({ t, head: pose, hands: { left: null, right: null }, balls: { left: null, leftShadow: null, right: null, rightShadow: null }, micBar: null, personalUi: null });
const take = { version: 1, actorId: "Nikk2", recordedAt: Date.now(), durationMs: 1000, body: null, showPersonalUi: false, frames: [frame(0), frame(1000)], audioBase64: Buffer.from("recorded voice").toString("base64"), audioMime: "audio/webm" };

describe("lobby welcome recordings", () => {
  it("only lets authenticated human creators publish their own take", async () => {
    const { app, as } = boot();
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", payload: take })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie: as("Visitor") }, payload: take })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie: as("Nikk2", "agent") }, payload: take })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie: as("baiwei2") }, payload: take })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie: as("Nikk2") }, payload: take })).statusCode).toBe(200);
    await app.close();
  });
  it("serves published takes and remembers completion per account", async () => {
    const { app, as } = boot();
    await app.inject({ method: "PUT", url: "/bff/space/welcome", headers: { cookie: as("Nikk2") }, payload: take });
    const before = await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Visitor") } });
    expect(before.json()).toMatchObject({ completed: false, takes: [{ actorId: "Nikk2", audioBase64: take.audioBase64 }] });
    await app.inject({ method: "POST", url: "/bff/space/welcome/complete", headers: { cookie: as("Visitor") } });
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Visitor") } })).json().completed).toBe(true);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: as("Another") } })).json().completed).toBe(false);
    await app.close();
  });
});
