import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/** Agents' helpers: your own only, per room, and never people. */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const enterAs = (username: string, room: string) => {
    const sid = built.sessions.create(username, `${username}-token`, "agent");
    built.sessions.enterRoom(sid, room);
    return `${built.config.cookieName}=${sid}`;
  };
  return { ...built, enterAs };
};
const post = (app: ReturnType<typeof boot>["app"], cookie: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/bff/space/helpers", headers: { cookie }, payload: payload as object });
const read = async (app: ReturnType<typeof boot>["app"], cookie: string) =>
  JSON.parse((await app.inject({ method: "GET", url: "/bff/space/helpers", headers: { cookie } })).body).helpers;

describe("agents' helpers", () => {
  it("are the reporter's own, seen by the room, and not by another room", async () => {
    const { app, enterAs } = boot();
    const sill = enterAs("Sill", "calm");
    expect((await post(app, sill, { helpers: [{ label: "tests" }] })).statusCode).toBe(200);
    expect(await read(app, enterAs("nikk", "calm"))).toEqual({ Sill: [{ label: "tests", state: "working" }] });
    expect(await read(app, enterAs("nikk", "saha.ing"))).toEqual({});
    await app.close();
  });

  it("cannot be put on somebody else: a name in the body is ignored", async () => {
    const { app, enterAs } = boot();
    await post(app, enterAs("Sill", "calm"), { actorId: "Moraine", helpers: [{ label: "x" }] });
    expect(Object.keys(await read(app, enterAs("nikk", "calm")))).toEqual(["Sill"]);
    await app.close();
  });

  it("clears with an empty list, and refuses nonsense", async () => {
    const { app, enterAs } = boot();
    const sill = enterAs("Sill", "calm");
    await post(app, sill, { helpers: [{ label: "x" }] });
    await post(app, sill, { helpers: [] });
    expect(await read(app, sill)).toEqual({});
    expect((await post(app, sill, { helpers: "lots" })).statusCode).toBe(400);
    await app.close();
  });

  it("does not add anyone to presence", async () => {
    const { app, enterAs } = boot();
    const sill = enterAs("Sill", "calm");
    const before = JSON.parse((await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: sill } })).body).people.length;
    await post(app, sill, { helpers: [{ label: "a" }, { label: "b" }, { label: "c" }] });
    const after = JSON.parse((await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: sill } })).body).people.length;
    expect(after).toBe(before);
    await app.close();
  });
});
