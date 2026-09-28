import { randomUUID } from "node:crypto";
import { appendFileSync, createReadStream, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

type Db = import("node:sqlite").DatabaseSync;
const CREATORS = new Set(["nikk2", "baiwei2"]);
const FRAME_PART = 50;
const MAX_PART_BYTES = 2_000_000;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const vec = (p: any) => p && finite(p.x) && finite(p.y) && finite(p.z);
const quat = (q: any) => q && finite(q.x) && finite(q.y) && finite(q.z) && finite(q.w);
const pose = (p: any) => p && vec(p.p) && quat(p.q);
const hand = (h: any) => h === null || (pose(h) && (h.f === undefined || (Array.isArray(h.f) && h.f.length <= 30 && h.f.every(finite))));
const control = (p: any) => p === null || (p && vec(p.p) && (p.q === undefined || quat(p.q)));
const frameValid = (f: any, duration: number) => f && finite(f.t) && f.t >= 0 && f.t <= duration + 100 && pose(f.head) && f.hands && hand(f.hands.left) && hand(f.hands.right) && f.balls && [f.balls.left, f.balls.leftShadow, f.balls.right, f.balls.rightShadow, f.micBar, f.personalUi].every(control) && (f.others === undefined || (Array.isArray(f.others) && f.others.every((p: any) => p && typeof p.actorId === "string" && p.actorId.length <= 100 && (p.kind === "human" || p.kind === "agent") && pose(p.head) && p.hands && hand(p.hands.left) && hand(p.hands.right) && (p.body === null || typeof p.body === "string"))));
const owned = (db: Db, id: string, actor: string) => db.prepare("SELECT * FROM lobby_welcome_uploads WHERE id = ? AND lower(actor_id) = ?").get(id, actor.toLowerCase()) as { header_json: string; frame_count: number; mime: string } | undefined;

export function registerWelcomeClips(app: FastifyInstance, config: Config, sessions: SessionStore, db: Db, blobRoot: string): void {
  const requireSession = makeRequireSession(config, sessions);
  const creator = (session: { username: string; kind: string }) => session.kind === "human" && CREATORS.has(session.username.toLowerCase());
  const consentValid = (actorId: string, recordedAt: number) => {
    const row = db.prepare("SELECT allowed,updated_at FROM lobby_welcome_consent WHERE actor_id = ?").get(actorId.toLowerCase()) as { allowed: number; updated_at: string } | undefined;
    return row?.allowed === 1 && Date.parse(row.updated_at) <= recordedAt;
  };
  const clipsDir = join(blobRoot, "welcome-clips");
  const partsDir = join(blobRoot, "welcome-upload-parts");
  mkdirSync(clipsDir, { recursive: true });
  mkdirSync(partsDir, { recursive: true });
  const cleanupStale = () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stale = db.prepare("SELECT p.data_path FROM lobby_welcome_upload_parts p JOIN lobby_welcome_uploads u ON u.id = p.upload_id WHERE u.created_at < ?").all(cutoff) as Array<{ data_path: string }>;
    for (const part of stale) rmSync(part.data_path, { force: true });
    db.prepare("DELETE FROM lobby_welcome_uploads WHERE created_at < ?").run(cutoff);
  };
  cleanupStale();

  app.get("/bff/space/welcome/consent", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const allowed = (db.prepare("SELECT actor_id FROM lobby_welcome_consent WHERE allowed = 1").all() as Array<{ actor_id: string }>).map((row) => row.actor_id);
    return { allowed, mine: allowed.some((name) => name.toLowerCase() === session.username.toLowerCase()) };
  });
  app.put<{ Body: { allowed?: unknown } }>("/bff/space/welcome/consent", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (typeof request.body?.allowed !== "boolean") return reply.code(400).send({ code: "BAD_WELCOME_CONSENT" });
    db.prepare("INSERT INTO lobby_welcome_consent (actor_id,allowed,updated_at) VALUES (?,?,?) ON CONFLICT(actor_id) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at").run(session.username.toLowerCase(), request.body.allowed ? 1 : 0, new Date().toISOString());
    if (!request.body.allowed) {
      const rows = db.prepare("SELECT id,participants_json FROM lobby_welcome_clips WHERE active = 1").all() as Array<{ id: string; participants_json: string }>;
      for (const row of rows) if ((JSON.parse(row.participants_json) as string[]).includes(session.username.toLowerCase())) db.prepare("UPDATE lobby_welcome_clips SET active = 0 WHERE id = ?").run(row.id);
    }
    return { ok: true, allowed: request.body.allowed };
  });

  app.get("/bff/space/welcome/clips", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (!creator(session)) return reply.send({ clips: [] });
    const rows = db.prepare("SELECT id, actor_id, title, duration_ms, uploaded_at, active, take_json FROM lobby_welcome_clips WHERE lower(actor_id) = ? ORDER BY uploaded_at DESC").all(session.username.toLowerCase()) as Array<{ id: string; actor_id: string; title: string; duration_ms: number | null; uploaded_at: string; active: number; take_json: string | null }>;
    return { clips: rows.map((row) => ({ id: row.id, actorId: row.actor_id, title: row.title, uploadedAt: row.uploaded_at, active: !!row.active, durationMs: row.duration_ms ?? (JSON.parse(row.take_json!) as { durationMs: number }).durationMs })) };
  });

  app.post<{ Body: unknown }>("/bff/space/welcome/uploads", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (!creator(session)) return reply.code(403).send({ code: "WELCOME_CREATOR_ONLY" });
    const v = request.body as Record<string, unknown> | null;
    const title = typeof v?.title === "string" ? v.title.trim() : "";
    if (!title || title.length > 120 || !finite(v?.durationMs) || v.durationMs <= 0 || !Number.isSafeInteger(v.frameCount) || (v.frameCount as number) < 2 || !finite(v.recordedAt) || typeof v.audioMime !== "string" || !/^audio\/(webm|mp4|ogg)(?:;[\w=.-]+)?$/.test(v.audioMime)) return reply.code(400).send({ code: "BAD_WELCOME_UPLOAD" });
    const id = randomUUID();
    const header = { version: 1, id, title, actorId: session.username, recordedAt: v.recordedAt, durationMs: v.durationMs, body: typeof v.body === "string" ? v.body : null, showPersonalUi: v.showPersonalUi === true, includeHumans: v.includeHumans === true, includeAgents: v.includeAgents === true };
    cleanupStale();
    db.prepare("INSERT INTO lobby_welcome_uploads (id,actor_id,header_json,mime,frame_count,created_at) VALUES (?,?,?,?,?,?)").run(id, session.username, JSON.stringify(header), v.audioMime as string, v.frameCount as number, new Date().toISOString());
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { id: string } }>("/bff/space/welcome/uploads/:id/status", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (!creator(session) || !owned(db, request.params.id, session.username)) return reply.code(404).send({ code: "WELCOME_UPLOAD_NOT_FOUND" });
    const rows = db.prepare("SELECT kind,part FROM lobby_welcome_upload_parts WHERE upload_id = ?").all(request.params.id) as Array<{ kind: string; part: number }>;
    return { frames: rows.filter((row) => row.kind === "frames").map((row) => row.part), audio: rows.filter((row) => row.kind === "audio").map((row) => row.part) };
  });

  app.put<{ Params: { id: string; kind: string; part: string }; Body: unknown }>("/bff/space/welcome/uploads/:id/:kind/:part", { bodyLimit: MAX_PART_BYTES }, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const upload = owned(db, request.params.id, session.username);
    if (!creator(session) || !upload) return reply.code(404).send({ code: "WELCOME_UPLOAD_NOT_FOUND" });
    const part = Number(request.params.part);
    if (!Number.isSafeInteger(part) || part < 0 || request.params.kind !== "frames" && request.params.kind !== "audio") return reply.code(400).send({ code: "BAD_WELCOME_PART" });
    let data: Buffer;
    if (request.params.kind === "frames") {
      if (part >= Math.ceil(upload.frame_count / FRAME_PART) || !Array.isArray(request.body) || request.body.length < 1 || request.body.length > FRAME_PART) return reply.code(400).send({ code: "BAD_WELCOME_PART" });
      const duration = (JSON.parse(upload.header_json) as { durationMs: number }).durationMs;
      if (!(request.body as any[]).every((frame) => frameValid(frame, duration))) return reply.code(400).send({ code: "BAD_WELCOME_PART" });
      data = Buffer.from(JSON.stringify(request.body));
    } else {
      if (part > 1_000_000 || !Buffer.isBuffer(request.body) || request.body.length < 1) return reply.code(400).send({ code: "BAD_WELCOME_PART" });
      data = request.body;
    }
    const path = join(partsDir, `${request.params.id}-${request.params.kind}-${part}`);
    const disk = statfsSync(partsDir);
    if (disk.bavail * disk.bsize < data.length + 100_000_000) return reply.code(507).send({ code: "WELCOME_STORAGE_FULL" });
    writeFileSync(path, data);
    db.prepare("INSERT INTO lobby_welcome_upload_parts (upload_id,kind,part,data_path) VALUES (?,?,?,?) ON CONFLICT(upload_id,kind,part) DO UPDATE SET data_path=excluded.data_path").run(request.params.id, request.params.kind, part, path);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/bff/space/welcome/uploads/:id/complete", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const upload = owned(db, request.params.id, session.username);
    if (!creator(session) || !upload) return reply.code(404).send({ code: "WELCOME_UPLOAD_NOT_FOUND" });
    const parts = db.prepare("SELECT kind,part,data_path FROM lobby_welcome_upload_parts WHERE upload_id = ? ORDER BY kind,part").all(request.params.id) as Array<{ kind: string; part: number; data_path: string }>;
    const frameParts = parts.filter((p) => p.kind === "frames");
    const audioParts = parts.filter((p) => p.kind === "audio");
    if (frameParts.length !== Math.ceil(upload.frame_count / FRAME_PART) || !audioParts.length || frameParts.some((p, i) => p.part !== i) || audioParts.some((p, i) => p.part !== i)) return reply.code(400).send({ code: "INCOMPLETE_WELCOME_UPLOAD" });
    const required = parts.reduce((total, part) => total + statSync(part.data_path).size, 0) + 100_000_000;
    const disk = statfsSync(clipsDir);
    if (disk.bavail * disk.bsize < required) return reply.code(507).send({ code: "WELCOME_STORAGE_FULL" });
    const header = JSON.parse(upload.header_json) as { id: string; title: string; actorId: string; recordedAt: number; durationMs: number };
    const takeTemp = join(clipsDir, `${header.id}.json.tmp`);
    const audioTemp = join(clipsDir, `${header.id}.audio.tmp`);
    const takePath = join(clipsDir, `${header.id}.json`);
    const audioPath = join(clipsDir, `${header.id}.audio`);
    let count = 0, last = -1;
    const participants = new Set<string>();
    writeFileSync(takeTemp, `${JSON.stringify(header).slice(0, -1)},"frames":[`);
    for (const part of frameParts) {
      const frames = JSON.parse(readFileSync(part.data_path, "utf8")) as Array<{ t: number; others?: Array<{ actorId: string }> }>;
      for (const frame of frames) for (const person of frame.others ?? []) participants.add(person.actorId.toLowerCase());
      if (frames.some((frame) => { const bad = frame.t < last; last = frame.t; return bad; })) { rmSync(takeTemp, { force: true }); return reply.code(400).send({ code: "BAD_WELCOME_TIMELINE" }); }
      if (count) appendFileSync(takeTemp, ",");
      appendFileSync(takeTemp, JSON.stringify(frames).slice(1, -1));
      count += frames.length;
    }
    if (count !== upload.frame_count) { rmSync(takeTemp, { force: true }); return reply.code(400).send({ code: "BAD_WELCOME_TIMELINE" }); }
    if ([...participants].some((actorId) => !consentValid(actorId, header.recordedAt))) { rmSync(takeTemp, { force: true }); return reply.code(403).send({ code: "WELCOME_PARTICIPANT_CONSENT" }); }
    appendFileSync(takeTemp, "]}");
    writeFileSync(audioTemp, Buffer.alloc(0));
    for (const part of audioParts) appendFileSync(audioTemp, readFileSync(part.data_path));
    renameSync(takeTemp, takePath);
    renameSync(audioTemp, audioPath);
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO lobby_welcome_clips (id,actor_id,title,duration_ms,participants_json,take_path,audio_path,mime,active,uploaded_at) VALUES (?,?,?,?,?,?,?,?,0,?)").run(header.id, header.actorId, header.title, header.durationMs, JSON.stringify([...participants]), takePath, audioPath, upload.mime, new Date().toISOString());
      db.prepare("DELETE FROM lobby_welcome_uploads WHERE id = ?").run(request.params.id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); rmSync(takePath, { force: true }); rmSync(audioPath, { force: true }); throw error; }
    for (const part of parts) rmSync(part.data_path, { force: true });
    return { ok: true, id: header.id };
  });

  app.get<{ Params: { id: string; kind: string } }>("/bff/space/welcome/clips/:id/:kind", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const row = db.prepare("SELECT actor_id,active,participants_json,take_json,audio,take_path,audio_path,mime,uploaded_at FROM lobby_welcome_clips WHERE id = ?").get(request.params.id) as { actor_id: string; active: number; participants_json: string; take_json: string | null; audio: Uint8Array | null; take_path: string | null; audio_path: string | null; mime: string; uploaded_at: string } | undefined;
    if (!row || (!row.active && (session.kind !== "human" || row.actor_id.toLowerCase() !== session.username.toLowerCase()))) return reply.code(404).send({ code: "WELCOME_CLIP_NOT_FOUND" });
    if ((JSON.parse(row.participants_json) as string[]).some((actorId) => !consentValid(actorId, Date.parse(row.uploaded_at)))) return reply.code(403).send({ code: "WELCOME_PARTICIPANT_CONSENT" });
    if (request.params.kind === "take") return reply.type("application/json").send(row.take_path ? createReadStream(row.take_path) : row.take_json);
    if (request.params.kind === "audio") return reply.header("ETag", `"${row.uploaded_at}"`).header("Cache-Control", "private, max-age=300").type(row.mime).send(row.audio_path ? createReadStream(row.audio_path) : Buffer.from(row.audio!));
    return reply.code(404).send({ code: "WELCOME_CLIP_NOT_FOUND" });
  });

  app.patch<{ Params: { id: string }; Body: { active?: unknown } }>("/bff/space/welcome/clips/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (!creator(session)) return reply.code(403).send({ code: "WELCOME_CREATOR_ONLY" });
    if (typeof request.body?.active !== "boolean") return reply.code(400).send({ code: "BAD_WELCOME_CLIP" });
    const row = db.prepare("SELECT participants_json,uploaded_at FROM lobby_welcome_clips WHERE id = ? AND lower(actor_id) = ?").get(request.params.id, session.username.toLowerCase()) as { participants_json: string; uploaded_at: string } | undefined;
    if (!row) return reply.code(404).send({ code: "WELCOME_CLIP_NOT_FOUND" });
    if (request.body.active && (JSON.parse(row.participants_json) as string[]).some((actorId) => !consentValid(actorId, Date.parse(row.uploaded_at)))) return reply.code(403).send({ code: "WELCOME_PARTICIPANT_CONSENT" });
    db.prepare("UPDATE lobby_welcome_clips SET active = ? WHERE id = ?").run(request.body.active ? 1 : 0, request.params.id);
    return { ok: true, active: request.body.active };
  });

  app.delete<{ Params: { id: string } }>("/bff/space/welcome/clips/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (!creator(session)) return reply.code(403).send({ code: "WELCOME_CREATOR_ONLY" });
    const row = db.prepare("SELECT take_path,audio_path FROM lobby_welcome_clips WHERE id = ? AND lower(actor_id) = ?").get(request.params.id, session.username.toLowerCase()) as { take_path: string | null; audio_path: string | null } | undefined;
    db.prepare("DELETE FROM lobby_welcome_clips WHERE id = ? AND lower(actor_id) = ?").run(request.params.id, session.username.toLowerCase());
    if (row?.take_path) rmSync(row.take_path, { force: true });
    if (row?.audio_path) rmSync(row.audio_path, { force: true });
    return { ok: true };
  });
}
