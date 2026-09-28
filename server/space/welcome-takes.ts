import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

type Db = import("node:sqlite").DatabaseSync;
const CREATORS = ["Nikk2", "baiwei2"];
const MAX_AUDIO = 12_000_000;
const MAX_FRAMES = 2_500;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vector = (value: any): boolean => value && finite(value.x) && finite(value.y) && finite(value.z);
const quaternion = (value: any): boolean => value && finite(value.x) && finite(value.y) && finite(value.z) && finite(value.w);
const control = (value: any): boolean => value === null || (value && vector(value.p) && (value.q === undefined || quaternion(value.q)));
const pose = (value: any): boolean => value && vector(value.p) && quaternion(value.q);
const hand = (value: any): boolean => value === null || (pose(value) && (value.f === undefined || (Array.isArray(value.f) && value.f.length <= 30 && value.f.every(finite))));
const validFrame = (frame: any, index: number, frames: any[], durationMs: number): boolean =>
  frame && finite(frame.t) && frame.t >= 0 && frame.t <= durationMs + 100 && (index === 0 || frame.t >= frames[index - 1].t) &&
  pose(frame.head) && frame.hands && hand(frame.hands.left) && hand(frame.hands.right) && frame.balls &&
  [frame.balls.left, frame.balls.leftShadow, frame.balls.right, frame.balls.rightShadow, frame.micBar, frame.personalUi].every(control);

export function registerWelcomeTakes(app: FastifyInstance, config: Config, sessions: SessionStore, db: Db): void {
  const requireSession = makeRequireSession(config, sessions);
  const published = () => (db.prepare("SELECT actor_id, take_json, published_at FROM lobby_welcome_takes WHERE active = 1").all() as Array<{ actor_id: string; take_json: string; published_at: string }>);
  app.get("/bff/space/welcome", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const rows = published().sort((a, b) => CREATORS.findIndex((name) => name.toLowerCase() === a.actor_id.toLowerCase()) - CREATORS.findIndex((name) => name.toLowerCase() === b.actor_id.toLowerCase()));
    const seen = db.prepare("SELECT 1 FROM lobby_welcome_seen WHERE actor_id = ?").get(session.username.toLowerCase());
    const own = db.prepare("SELECT published_at FROM lobby_welcome_takes WHERE lower(actor_id) = ?").get(session.username.toLowerCase()) as { published_at: string } | undefined;
    return { canPublish: session.kind === "human" && CREATORS.some((name) => name.toLowerCase() === session.username.toLowerCase()), uploadedMine: own ? { actorId: session.username, publishedAt: own.published_at } : null, completed: !!seen, takes: rows.map((row) => ({ actorId: row.actor_id, durationMs: (JSON.parse(row.take_json) as { durationMs: number }).durationMs, publishedAt: row.published_at })) };
  });
  app.get<{ Params: { actor: string } }>("/bff/space/welcome/:actor/take", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const row = db.prepare("SELECT take_json, active, actor_id FROM lobby_welcome_takes WHERE lower(actor_id) = ?").get(request.params.actor.toLowerCase()) as { take_json: string; active: number; actor_id: string } | undefined;
    if (!row) return reply.code(404).send({ code: "WELCOME_TAKE_NOT_FOUND" });
    if (!row.active && (session.kind !== "human" || row.actor_id.toLowerCase() !== session.username.toLowerCase())) return reply.code(404).send({ code: "WELCOME_TAKE_NOT_FOUND" });
    return reply.type("application/json").send(row.take_json);
  });
  app.get<{ Params: { actor: string } }>("/bff/space/welcome/:actor/audio", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const row = db.prepare("SELECT audio, mime, published_at, active, actor_id FROM lobby_welcome_takes WHERE lower(actor_id) = ?").get(request.params.actor.toLowerCase()) as { audio: Uint8Array; mime: string; published_at: string; active: number; actor_id: string } | undefined;
    if (!row) return reply.code(404).send({ code: "WELCOME_TAKE_NOT_FOUND" });
    if (!row.active && (session.kind !== "human" || row.actor_id.toLowerCase() !== session.username.toLowerCase())) return reply.code(404).send({ code: "WELCOME_TAKE_NOT_FOUND" });
    const etag = `"${row.published_at}"`;
    reply.header("ETag", etag).header("Cache-Control", "private, max-age=300");
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(row.mime).send(Buffer.from(row.audio));
  });
  app.put<{ Body: unknown }>("/bff/space/welcome", { bodyLimit: 19_000_000 }, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (session.kind !== "human" || !CREATORS.some((name) => name.toLowerCase() === session.username.toLowerCase())) return reply.code(403).send({ code: "WELCOME_CREATOR_ONLY" });
    const value = request.body as Record<string, unknown> | null;
    const frames = value?.frames;
    const audioBase64 = value?.audioBase64;
    const durationMs = value?.durationMs;
    const mime = value?.audioMime;
    if (value?.version !== 1 || value.actorId !== session.username || !Array.isArray(frames) || frames.length < 2 || frames.length > MAX_FRAMES || typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 120_000 || typeof audioBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64) || typeof mime !== "string" || !/^audio\/(webm|mp4|ogg)(?:;[\w=.-]+)?$/.test(mime)) return reply.code(400).send({ code: "BAD_WELCOME_TAKE" });
    const audio = Buffer.from(audioBase64, "base64");
    if (!audio.length || audio.length > MAX_AUDIO || frames.some((frame, index) => !validFrame(frame, index, frames, durationMs))) return reply.code(400).send({ code: "BAD_WELCOME_TAKE" });
    const take = { version: 1, actorId: session.username, recordedAt: value.recordedAt, durationMs, body: typeof value.body === "string" ? value.body : null, showPersonalUi: value.showPersonalUi === true, frames };
    db.prepare("INSERT INTO lobby_welcome_takes (actor_id,take_json,audio,mime,active,published_at) VALUES (?,?,?,?,0,?) ON CONFLICT(actor_id) DO UPDATE SET take_json=excluded.take_json,audio=excluded.audio,mime=excluded.mime,active=0,published_at=excluded.published_at").run(session.username, JSON.stringify(take), audio, mime, new Date().toISOString());
    return { ok: true };
  });
  app.delete("/bff/space/welcome", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (session.kind !== "human" || !CREATORS.some((name) => name.toLowerCase() === session.username.toLowerCase())) return reply.code(403).send({ code: "WELCOME_CREATOR_ONLY" });
    db.prepare("DELETE FROM lobby_welcome_takes WHERE lower(actor_id) = ?").run(session.username.toLowerCase());
    return { ok: true };
  });
  app.post("/bff/space/welcome/complete", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    db.prepare("INSERT OR IGNORE INTO lobby_welcome_seen (actor_id,completed_at) VALUES (?,?)").run(session.username.toLowerCase(), new Date().toISOString());
    return { ok: true };
  });
}
