import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

type Db = import("node:sqlite").DatabaseSync;
const CREATORS = ["Nikk2", "baiwei2"];

/**
 * The first-visit welcome: which recordings to play, and whether you have seen it.
 *
 * Recordings are welcome-clips.ts's (named, several people, resumable uploads).
 * This file used to be the first version of that, one take per creator with its
 * own upload, delete, movement and audio routes and its own table, still
 * mirrored into the clips table under "<name>-legacy". The page moved to clips on
 * 2026-09-28 and nothing has called those routes since, so they went on
 * 2026-10-20; lobby_welcome_takes keeps the one inactive take it holds.
 */
export function registerWelcomeTakes(app: FastifyInstance, config: Config, sessions: SessionStore, db: Db): void {
  const requireSession = makeRequireSession(config, sessions);
  const published = () => (db.prepare("SELECT id, actor_id, duration_ms, take_json, uploaded_at AS published_at, participants_json FROM lobby_welcome_clips WHERE active = 1").all() as Array<{ id: string; actor_id: string; duration_ms: number | null; take_json: string | null; published_at: string; participants_json: string }>);
  app.get("/bff/space/welcome", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const rows = published().filter((row) => (JSON.parse(row.participants_json) as string[]).every((actorId) => { const consent = db.prepare("SELECT allowed,updated_at FROM lobby_welcome_consent WHERE actor_id = ?").get(actorId) as { allowed: number; updated_at: string } | undefined; return consent?.allowed === 1 && Date.parse(consent.updated_at) <= Date.parse(row.published_at); })).sort((a, b) => CREATORS.findIndex((name) => name.toLowerCase() === a.actor_id.toLowerCase()) - CREATORS.findIndex((name) => name.toLowerCase() === b.actor_id.toLowerCase()) || a.published_at.localeCompare(b.published_at));
    const seen = db.prepare("SELECT 1 FROM lobby_welcome_seen WHERE actor_id = ?").get(session.username.toLowerCase());
    return { canPublish: session.kind === "human" && CREATORS.some((name) => name.toLowerCase() === session.username.toLowerCase()), completed: !!seen, takes: rows.map((row) => ({ id: row.id, actorId: row.actor_id, durationMs: row.duration_ms ?? (JSON.parse(row.take_json!) as { durationMs: number }).durationMs, publishedAt: row.published_at })) };
  });
  app.post("/bff/space/welcome/complete", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    db.prepare("INSERT OR IGNORE INTO lobby_welcome_seen (actor_id,completed_at) VALUES (?,?)").run(session.username.toLowerCase(), new Date().toISOString());
    return { ok: true };
  });
}
