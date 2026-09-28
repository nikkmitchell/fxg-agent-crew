import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of running.splice(0)) await close();
});

async function boot() {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: tempDir("mindfulness-blobs-"),
    LOG_LEVEL: "silent",
  });
  await built.app.listen({ host: "127.0.0.1", port: 0 });
  running.push(async () => void (await built.app.close()));
  const as = (username: string, room: string) => {
    const sid = built.sessions.create(username, "test-token", "human");
    built.sessions.enterRoom(sid, room);
    return `${built.config.cookieName}=${sid}`;
  };
  return { ...built, as };
}

const call = (app: FastifyInstance, cookie: string | undefined, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> => {
  const options: InjectOptions = { method, url, ...(cookie ? { headers: { cookie } } : {}), ...(payload === undefined ? {} : { payload }) };
  return app.inject(options);
};

describe("shared mindfulness page", () => {
  it("persists by room, hides authors, and lets only the writer remove a card", async () => {
    const { app, as } = await boot();
    const writer = as("Inkstone", "meditation.AR");
    const writerWithDifferentCase = as("inkstone", "meditation.ar");
    const reader = as("Sill", "meditation.ar");
    const otherRoom = as("Nightjar", "quiet-garden");

    const posted = await call(app, writer, "POST", "/bff/space/mindfulness", { text: "  sunlight   on the desk  " });
    expect(posted.statusCode).toBe(201);
    const { card } = posted.json();
    expect(card.text).toBe("sunlight on the desk");
    expect(card.mine).toBe(true);
    expect(JSON.stringify(card)).not.toContain("Inkstone");
    expect(JSON.stringify(card)).not.toContain("created_by");

    const sameRoom = await call(app, reader, "GET", "/bff/space/mindfulness");
    expect(sameRoom.json().cards).toEqual([{ ...card, mine: false }]);
    expect((await call(app, writerWithDifferentCase, "GET", "/bff/space/mindfulness")).json().cards[0].mine).toBe(true);
    expect((await call(app, otherRoom, "GET", "/bff/space/mindfulness")).json().cards).toEqual([]);
    expect((await call(app, reader, "DELETE", `/bff/space/mindfulness/${card.id}`)).statusCode).toBe(404);
    expect((await call(app, writerWithDifferentCase, "DELETE", `/bff/space/mindfulness/${card.id}`)).statusCode).toBe(200);
    expect((await call(app, reader, "GET", "/bff/space/mindfulness")).json().cards).toEqual([]);
  });

  it("rejects blank or oversized text and limits repeated sharing", async () => {
    const { app, as } = await boot();
    const writer = as("Inkstone", "meditation.AR");
    const blank = await call(app, writer, "POST", "/bff/space/mindfulness", { text: "  " });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toContain("reflection");
    expect((await call(app, writer, "POST", "/bff/space/mindfulness", { text: "x".repeat(241) })).statusCode).toBe(400);
    for (let i = 0; i < 8; i += 1) {
      expect((await call(app, writer, "POST", "/bff/space/mindfulness", { text: `Card ${i}` })).statusCode).toBe(201);
    }
    const refused = await call(app, writer, "POST", "/bff/space/mindfulness", { text: "One more" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().code).toBe("SHARE_LIMIT");
  });

  it("paginates a growing room page without caching a viewer's private delete bit", async () => {
    const { app, as } = await boot();
    const firstWriter = as("Inkstone", "meditation.AR");
    const secondWriter = as("Sill", "meditation.AR");
    for (let i = 0; i < 8; i += 1) {
      expect((await call(app, firstWriter, "POST", "/bff/space/mindfulness", { text: `Inkstone ${i}` })).statusCode).toBe(201);
    }
    for (let i = 0; i < 5; i += 1) {
      expect((await call(app, secondWriter, "POST", "/bff/space/mindfulness", { text: `Sill ${i}` })).statusCode).toBe(201);
    }
    const latest = await call(app, firstWriter, "GET", "/bff/space/mindfulness");
    expect(latest.headers["cache-control"]).toBe("no-store");
    expect(latest.json().cards).toHaveLength(12);
    expect(latest.json().older).toEqual(expect.any(Number));
    const older = await call(app, firstWriter, "GET", `/bff/space/mindfulness?before=${latest.json().older}`);
    expect(older.json().cards).toHaveLength(1);
    expect(older.json().cards[0].text).toBe("Inkstone 0");
    expect(older.json().cards[0].mine).toBe(true);
    expect((await call(app, firstWriter, "GET", "/bff/space/mindfulness?before=invalid")).statusCode).toBe(400);
  });

  it("requires a signed-in room session", async () => {
    const { app } = await boot();
    expect((await call(app, undefined, "GET", "/bff/space/mindfulness")).statusCode).toBe(401);
    expect((await call(app, undefined, "POST", "/bff/space/mindfulness", { text: "not shared" })).statusCode).toBe(401);
  });
});
