import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { MOST_STICKS } from "../../shared/incense.js";
import { tempDir } from "./test-config.js";

/**
 * THE ROOM'S MOMENTS: boats, lanterns, driftwood, the ember fire, incense, the
 * hourglass, the prayer wheel and the sound bath. Each is a thing somebody does
 * that the whole room sees, kept in memory for as long as it lasts, with a rest
 * between one person's turns. Eight files did that eight ways and none had a
 * test (Kerf, 2026-10-14); this says what each one does, as the room sees it.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: tempDir("blobs-"),
    LOG_LEVEL: "silent",
  });
  const as = (username: string, room?: string) => {
    const sid = built.sessions.create(username, "t", "human");
    if (room) built.sessions.enterRoom(sid, room);
    return `${built.config.cookieName}=${sid}`;
  };
  const told = (room: string) => {
    const said: unknown[] = [];
    vi.spyOn(built.hubFor(room), "broadcast").mockImplementation((message) => void said.push(message));
    return said;
  };
  return { ...built, as, told };
};

let app: ReturnType<typeof boot>["app"] | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
});

const start = () => {
  const built = boot();
  app = built.app;
  const get = (path: string, cookie: string) => built.app.inject({ method: "GET", url: path, headers: { cookie } });
  const post = (path: string, cookie: string, payload: object = {}) => built.app.inject({ method: "POST", url: path, headers: { cookie }, payload });
  return { ...built, get, post };
};

describe("every moment needs somebody signed in", () => {
  it.each([
    "/bff/space/boats", "/bff/space/lanterns", "/bff/space/driftwood", "/bff/space/fire",
    "/bff/space/incense", "/bff/space/hourglass", "/bff/space/wheel", "/bff/space/sound-bath",
  ])("POST %s without a session is 401", async (path) => {
    const { post } = start();
    const answer = await post(path, "nobody=1", { word: "hope" });
    expect(answer.statusCode).toBe(401);
    expect(answer.json()).toMatchObject({ code: "SESSION_EXPIRED", reauth: true });
  });
});

describe("boats", () => {
  it("one sails, the room is told, it is on the pond, and the next waits its turn", async () => {
    const { as, told, get, post } = start();
    const said = told("pond.room");
    const nikk = as("Nikk", "pond.room");
    const sailed = await post("/bff/space/boats", nikk);
    expect(sailed.statusCode).toBe(200);
    const boat = sailed.json().boat;
    expect(boat).toMatchObject({ by: "Nikk" });
    expect(said).toEqual([{ type: "boat", boat }]);
    expect((await get("/bff/space/boats", nikk)).json().boats).toEqual([boat]);
    expect((await post("/bff/space/boats", nikk)).statusCode).toBe(429);
    // Another room's pond is its own.
    expect((await get("/bff/space/boats", as("Mica", "other.room"))).json().boats).toEqual([]);
  });
});

describe("lanterns", () => {
  it("rise with their word, are in the sky, and wait their turn", async () => {
    const { as, told, get, post } = start();
    const said = told("sky.room");
    const nikk = as("Nikk", "sky.room");
    const rose = await post("/bff/space/lanterns", nikk, { word: "hope" });
    expect(rose.statusCode).toBe(200);
    const lantern = rose.json().lantern;
    expect(lantern).toMatchObject({ by: "Nikk", word: "hope" });
    expect(said).toEqual([{ type: "lantern", lantern }]);
    expect((await get("/bff/space/lanterns", nikk)).json().lanterns).toEqual([lantern]);
    expect((await post("/bff/space/lanterns", nikk, { word: "again" })).statusCode).toBe(429);
  });
});

describe.each([
  ["driftwood", "driftwood", "drift", "hope"],
  ["fire", "fire", "offering", "worry"],
])("%s: a word told to the room, then forgotten", (path, type, field, word) => {
  it("refuses no word, tells the room a word, and waits its turn", async () => {
    const { as, told, post } = start();
    const said = told("shore.room");
    const nikk = as("Nikk", "shore.room");
    expect((await post(`/bff/space/${path}`, nikk, {})).statusCode).toBe(422);
    expect(said).toEqual([]);
    const given = await post(`/bff/space/${path}`, nikk, { word });
    expect(given.statusCode).toBe(200);
    expect(given.json()).toEqual({ ok: true });
    expect(said).toEqual([{ type, [field]: { by: "Nikk", word, at: expect.any(Number) } }]);
    expect((await post(`/bff/space/${path}`, nikk, { word })).statusCode).toBe(429);
  });
});

describe("incense", () => {
  it("lights a stick in the first free place, tells the room every stick, and the bowl fills", async () => {
    const { as, told, get, post } = start();
    const said = told("temple.room");
    const first = await post("/bff/space/incense", as("A0", "temple.room"));
    expect(first.statusCode).toBe(200);
    expect(first.json().sticks).toMatchObject([{ by: "A0", slot: 0 }]);
    expect(said).toEqual([{ type: "incense", sticks: first.json().sticks }]);
    expect((await post("/bff/space/incense", as("A0", "temple.room"))).statusCode).toBe(429);
    for (let n = 1; n < MOST_STICKS; n += 1) expect((await post("/bff/space/incense", as(`A${n}`, "temple.room"))).statusCode).toBe(200);
    const full = await post("/bff/space/incense", as("Late", "temple.room"));
    expect(full.statusCode).toBe(422);
    expect(full.json().code).toBe("FULL");
    expect((await get("/bff/space/incense", as("Look", "temple.room"))).json().sticks).toHaveLength(MOST_STICKS);
  });
});

describe("the hourglass", () => {
  it("stands unturned, turns for everyone, and lets the sand settle", async () => {
    const { as, told, get, post } = start();
    const said = told("glass.room");
    const nikk = as("Nikk", "glass.room");
    expect((await get("/bff/space/hourglass", nikk)).json().glass).toEqual({ turnedAt: null, topThen: 0 });
    const turned = await post("/bff/space/hourglass", nikk);
    expect(turned.statusCode).toBe(200);
    const glass = turned.json().glass;
    expect(glass.turnedAt).toEqual(expect.any(Number));
    expect(said).toEqual([{ type: "hourglass", glass }]);
    expect((await get("/bff/space/hourglass", nikk)).json().glass).toEqual(glass);
    expect((await post("/bff/space/hourglass", nikk)).statusCode).toBe(429);
  });
});

describe("the prayer wheel", () => {
  it("counts its turns for the room and lets it turn", async () => {
    const { as, told, get, post } = start();
    const said = told("wheel.room");
    const nikk = as("Nikk", "wheel.room");
    expect((await get("/bff/space/wheel", nikk)).json()).toEqual({ turns: 0 });
    const pushed = await post("/bff/space/wheel", nikk, { strength: 0.5 });
    expect(pushed.statusCode).toBe(200);
    const push = pushed.json().push;
    expect(push).toMatchObject({ by: "Nikk", turns: 1 });
    expect(said).toEqual([{ type: "wheel", push }]);
    expect((await get("/bff/space/wheel", nikk)).json()).toEqual({ turns: 1 });
    expect((await post("/bff/space/wheel", nikk)).statusCode).toBe(429);
    expect((await post("/bff/space/wheel", as("Mica", "wheel.room"))).json().push.turns).toBe(2);
  });
});

describe("the sound bath", () => {
  it("starts for everyone, will not start twice, and stops for everyone", async () => {
    const { as, told, get, post } = start();
    const said = told("bath.room");
    const nikk = as("Nikk", "bath.room");
    expect((await get("/bff/space/sound-bath", nikk)).json().startedAt).toBeNull();
    const started = await post("/bff/space/sound-bath", nikk, { action: "start" });
    expect(started.statusCode).toBe(200);
    const at = started.json().startedAt;
    expect(at).toEqual(expect.any(Number));
    expect(said).toEqual([{ type: "bath", bath: { startedAt: at, by: "Nikk" } }]);
    expect((await get("/bff/space/sound-bath", nikk)).json().startedAt).toBe(at);
    const again = await post("/bff/space/sound-bath", as("Mica", "bath.room"), { action: "start" });
    expect(again.statusCode).toBe(409);
    const stopped = await post("/bff/space/sound-bath", as("Mica", "bath.room"), { action: "stop" });
    expect(stopped.json().startedAt).toBeNull();
    expect(said.at(-1)).toEqual({ type: "bath", bath: { startedAt: null, by: "Mica" } });
    expect((await get("/bff/space/sound-bath", nikk)).json().startedAt).toBeNull();
  });
});
