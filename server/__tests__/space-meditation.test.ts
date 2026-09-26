import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/** The breathing orb: shared per room, kept across a restart, refused when stale. */
const boot = (path = ":memory:") => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: path,
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const enterAs = (username: string, room: string) => {
    const sid = built.sessions.create(username, `${username}-token`, "human");
    built.sessions.enterRoom(sid, room);
    return `${built.config.cookieName}=${sid}`;
  };
  return { ...built, enterAs };
};

const post = (app: ReturnType<typeof boot>["app"], cookie: string, payload: object) =>
  app.inject({ method: "POST", url: "/bff/space/meditation", headers: { cookie }, payload });
const read = async (app: ReturnType<typeof boot>["app"], cookie: string) =>
  JSON.parse((await app.inject({ method: "GET", url: "/bff/space/meditation", headers: { cookie } })).body).meditation;

describe("the room's breathing orb", () => {
  it("is not in a room until somebody puts it there, and then everyone in that room sees it", async () => {
    const { app, enterAs } = boot();
    const nikk = enterAs("nikk", "calm");
    const baiwei = enterAs("baiwei", "calm");
    const elsewhere = enterAs("sill", "saha.ing");
    expect((await read(app, nikk)).shown).toBe(false);

    expect((await post(app, nikk, { action: "show", shown: true })).statusCode).toBe(200);
    expect((await read(app, baiwei)).shown).toBe(true);
    expect((await read(app, elsewhere)).shown, "another room keeps its own").toBe(false);
    await app.close();
  });

  it("starts one session for everybody, and a second START on an old revision is refused", async () => {
    const { app, enterAs } = boot();
    const nikk = enterAs("nikk", "calm");
    const started = JSON.parse((await post(app, nikk, { action: "start", pattern: "box", minutes: 3, revision: 0 })).body).meditation;
    expect(started).toMatchObject({ pattern: "box", minutes: 3, startedBy: "nikk" });
    expect(typeof started.startedAt).toBe("number");

    const late = await post(app, enterAs("baiwei", "calm"), { action: "start", revision: 0 });
    expect(late.statusCode).toBe(409);
    await app.close();
  });

  it("says why a change is refused", async () => {
    const { app, enterAs } = boot();
    const response = await post(app, enterAs("nikk", "calm"), { action: "start", minutes: 7 });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/minutes/);
    await app.close();
  });

  it("is still there after a restart", async () => {
    const path = `/tmp/meditation-${Math.random().toString(36).slice(2)}.db`;
    const first = boot(path);
    await post(first.app, first.enterAs("nikk", "calm"), { action: "show", shown: true });
    // Closing the app closes its database, as a real stop does.
    await first.app.close();

    const second = boot(path);
    expect((await read(second.app, second.enterAs("nikk", "calm"))).shown).toBe(true);
    await second.app.close();
  });
});
