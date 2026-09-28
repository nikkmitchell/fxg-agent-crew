import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

const boot = () => {
  const root = tempDir("welcome-clips-");
  const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: root, LOG_LEVEL: "silent" });
  const as = (name: string, kind: "human" | "agent" = "human") => `${built.config.cookieName}=${built.sessions.create(name, "t", kind)}`;
  return { ...built, root, as };
};
const pose = { p: { x: 0, y: 1, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } };
const frame = (t: number, others: unknown[] = []) => ({ t, head: pose, hands: { left: null, right: null }, balls: { left: null, leftShadow: null, right: null, rightShadow: null }, micBar: null, personalUi: null, others });
const person = { actorId: "Visitor", kind: "human", head: pose, hands: { left: null, right: null }, body: null };
const meta = (count: number) => ({ title: "Welcome, part one", recordedAt: Date.now(), durationMs: 3000, body: null, showPersonalUi: false, includeHumans: true, includeAgents: false, frameCount: count, audioMime: "audio/webm" });

describe("multipart welcome clips", () => {
  it("allows only human creators to start an upload", async () => {
    const { app, as } = boot();
    for (const cookie of [undefined, as("Visitor"), as("Nikk2", "agent")]) {
      const result = await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: cookie ? { cookie } : {}, payload: meta(2) });
      expect(result.statusCode).toBe(cookie ? 403 : 401);
    }
    expect((await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: { cookie: as("Nikk2") }, payload: meta(2) })).statusCode).toBe(201);
    await app.close();
  });

  it("accepts out-of-order parts, rejects missing parts and a timeline that moves backwards", async () => {
    const { app, as } = boot();
    const cookie = as("Nikk2");
    const start = async () => (await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: { cookie }, payload: meta(51) })).json().id as string;
    const put = (id: string, part: number, frames: unknown[]) => app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/frames/${part}`, headers: { cookie }, payload: frames });
    const audio = (id: string) => app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/audio/0`, headers: { cookie, "content-type": "application/octet-stream" }, payload: Buffer.from("voice") });
    const complete = (id: string) => app.inject({ method: "POST", url: `/bff/space/welcome/uploads/${id}/complete`, headers: { cookie } });
    const id = await start();
    expect((await put(id, 1, [frame(2000)])).statusCode).toBe(200);
    await audio(id);
    expect((await complete(id)).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/bff/space/welcome/clips/${id}/take`, headers: { cookie } })).statusCode).toBe(404);
    expect((await put(id, 0, Array.from({ length: 50 }, (_, i) => frame(i * 40)))).statusCode).toBe(200);
    expect((await complete(id)).statusCode).toBe(200);

    const bad = await start();
    await put(bad, 0, Array.from({ length: 50 }, (_, i) => frame(i * 40)));
    await put(bad, 1, [frame(100)]);
    await audio(bad);
    expect((await complete(bad)).statusCode).toBe(400);
    await app.close();
  });

  it("keeps an unconsented participant out, then serves a redacted clip only to its creator until activated", async () => {
    const { app, as } = boot();
    const creator = as("Nikk2"), visitor = as("Visitor");
    const recordedAt = Date.now() + 1000;
    const newUpload = async () => (await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: { cookie: creator }, payload: { ...meta(2), recordedAt } })).json().id as string;
    const upload = async (id: string, others: unknown[]) => {
      await app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/frames/0`, headers: { cookie: creator }, payload: [frame(0, others), frame(1000, others)] });
      await app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/audio/0`, headers: { cookie: creator, "content-type": "application/octet-stream" }, payload: Buffer.from("creator-only audio") });
      return app.inject({ method: "POST", url: `/bff/space/welcome/uploads/${id}/complete`, headers: { cookie: creator } });
    };
    const rejected = await newUpload();
    expect((await upload(rejected, [person])).statusCode).toBe(403);
    const id = await newUpload();
    expect((await upload(id, [])).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/bff/space/welcome/clips/${id}/take`, headers: { cookie: visitor } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/bff/space/welcome/clips/${id}/take`, headers: { cookie: creator } })).json().frames[0].others).toEqual([]);
    expect((await app.inject({ method: "PATCH", url: `/bff/space/welcome/clips/${id}`, headers: { cookie: creator }, payload: { active: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: visitor } })).json().takes[0].id).toBe(id);
    expect((await app.inject({ method: "GET", url: `/bff/space/welcome/clips/${id}/take`, headers: { cookie: visitor } })).statusCode).toBe(200);
    await app.close();
  });

  it("deactivates an included clip when its participant opts out", async () => {
    const { app, as } = boot();
    const creator = as("Nikk2"), visitor = as("Visitor");
    await app.inject({ method: "PUT", url: "/bff/space/welcome/consent", headers: { cookie: visitor }, payload: { allowed: true } });
    const id = (await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: { cookie: creator }, payload: { ...meta(2), recordedAt: Date.now() + 1000 } })).json().id as string;
    await app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/frames/0`, headers: { cookie: creator }, payload: [frame(0, [person]), frame(1000, [person])] });
    await app.inject({ method: "PUT", url: `/bff/space/welcome/uploads/${id}/audio/0`, headers: { cookie: creator, "content-type": "application/octet-stream" }, payload: Buffer.from("mixed audio") });
    expect((await app.inject({ method: "POST", url: `/bff/space/welcome/uploads/${id}/complete`, headers: { cookie: creator } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/bff/space/welcome/clips/${id}`, headers: { cookie: creator }, payload: { active: true } })).statusCode).toBe(200);
    await app.inject({ method: "PUT", url: "/bff/space/welcome/consent", headers: { cookie: visitor }, payload: { allowed: false } });
    expect((await app.inject({ method: "GET", url: "/bff/space/welcome", headers: { cookie: visitor } })).json().takes).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/bff/space/welcome/clips/${id}/audio`, headers: { cookie: creator } })).statusCode).toBe(403);
    await app.close();
  });

  it("cleans up orphaned parts older than a day", async () => {
    const { app, as, database, root } = boot();
    await app.ready();
    const path = join(root, "welcome-upload-parts", "orphan");
    writeFileSync(path, "orphan");
    database.prepare("INSERT INTO lobby_welcome_uploads (id,actor_id,header_json,mime,frame_count,created_at) VALUES (?,?,?,?,?,?)").run("old", "Nikk2", "{}", "audio/webm", 2, new Date(Date.now() - 25 * 3600_000).toISOString());
    database.prepare("INSERT INTO lobby_welcome_upload_parts (upload_id,kind,part,data_path) VALUES (?,?,?,?)").run("old", "audio", 0, path);
    await app.inject({ method: "POST", url: "/bff/space/welcome/uploads", headers: { cookie: as("Nikk2") }, payload: meta(2) });
    expect(existsSync(path)).toBe(false);
    expect(database.prepare("SELECT 1 FROM lobby_welcome_uploads WHERE id = 'old'").get()).toBeUndefined();
    await app.close();
  });
});
