import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import { BoardReads } from "../db/reads.js";
import { BoardStore, Refused } from "../db/store.js";
import { BlobStore, MAX_BYTES } from "../db/blobs.js";
import type { Role, Status } from "../../shared/board-rules.js";

/**
 * The board API. saha.ing's own data, served from saha.ing's own database.
 *
 * WHAT IS AND IS NOT CHECKED HERE. Authentication is WebHarness's — a session
 * exists because upstream said who this is. Authorisation is ours, and it lives
 * in BoardStore, not in these handlers. A route that checked membership itself
 * would be a second place for the rule to live and a second place to get it
 * wrong; every write below simply calls the store and lets it refuse.
 */

const CODES: Record<string, number> = {
  PROJECT_PERMISSION_REQUIRED: 403,
  NOT_YOURS: 403,
  NOT_THE_AGENT: 403,
  NOT_AN_OWNER: 403,
  FORBIDDEN_FIELD: 400,
  ILLEGAL_TRANSITION: 409,
  CONFLICT: 409,
  NOT_FOUND: 404,
  BLOB_MISSING: 500,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  EMPTY_FILE: 400,
  BAD_URL: 400,
};

export function registerBoardRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  db: import("node:sqlite").DatabaseSync,
  blobRoot: string,
): void {
  const reads = new BoardReads(db);
  const store = new BoardStore(db);
  const blobs = new BlobStore(db, blobRoot);

  const requireSession = (request: FastifyRequest, reply: FastifyReply): Session | undefined => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
      return undefined;
    }
    return session;
  };

  const actorOf = (session: Session) => ({ id: session.username, kind: session.kind });

  /**
   * Refusals carry their reason to the browser.
   *
   * A store refusal is a sentence written for a person — "nikk is not a member
   * of saha; treat this as a request pending a manager". Replacing it with a
   * bare 403 would throw away the only part that tells someone what to do next.
   */
  const handle = async (reply: FastifyReply, request: FastifyRequest, work: () => unknown) => {
    try {
      // The envelope is what was ASKED. `before`/`after` in the audit is a diff
      // of state; this is the intent behind it, and the thing a signature would
      // later attach to.
      const envelope = { method: request.method, path: request.url, body: request.body ?? null };
      return reply.send({ ok: true, result: store.withRequest(envelope, () => work()) ?? null });
    } catch (error) {
      if (error instanceof Refused) {
        return reply.code(CODES[error.code] ?? 400).send({ code: error.code, error: error.message });
      }
      app.log.error({ err: error }, "board write failed");
      return reply.code(500).send({ code: "INTERNAL", error: "the change was not saved" });
    }
  };

  // ------------------------------------------------------------------- reads

  app.get("/bff/board/projects", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    return reply.send({ projects: reads.projects() });
  });

  app.get<{ Params: { id: string } }>("/bff/board/projects/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const view = reads.project(request.params.id);
    if (!view) return reply.code(404).send({ code: "NOT_FOUND", error: "no such project" });
    return reply.send(view);
  });

  app.get("/bff/board/people", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    return reply.send({
      actors: reads.actors(),
      ownerships: reads.ownerships(),
      memberships: reads.memberships(),
    });
  });

  app.get<{ Params: { entity: string; id: string } }>("/bff/board/history/:entity/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    return reply.send({ history: reads.history(request.params.entity, request.params.id) });
  });

  // ------------------------------------------------------------------ writes

  app.post<{ Body: { id?: string; name?: string; summary?: string; goals?: string[] } }>(
    "/bff/board/projects", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      return handle(reply, request, () => store.createProject(actorOf(session), {
        id: request.body?.id, name: request.body?.name ?? "", summary: request.body?.summary,
        goals: request.body?.goals,
      }));
    });

  app.post<{ Body: Record<string, never> }>("/bff/board/tasks", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = request.body as Record<string, unknown>;
    return handle(reply, request, () => store.createTask(actorOf(session), {
      projectId: String(body.projectId ?? ""), title: String(body.title ?? ""),
      description: body.description as string | undefined,
      kind: body.kind as "build" | "decision" | undefined,
      points: body.points as number | undefined,
      priority: body.priority as number | undefined,
      owners: body.owners as string[] | undefined,
    }));
  });

  app.patch<{ Params: { id: string } }>("/bff/board/tasks/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    return handle(reply, request, () => store.updateTask(actorOf(session), request.params.id, {
      title: body.title as string | undefined,
      // `null` and absent mean different things here — cleared versus not
      // mentioned — and the store depends on being able to tell them apart.
      description: "description" in body ? (body.description as string | null) : undefined,
      kind: "kind" in body ? (body.kind as "build" | "decision" | null) : undefined,
      points: body.points as number | undefined,
      priority: "priority" in body ? (body.priority as number | null) : undefined,
    }));
  });

  app.post<{ Params: { id: string }; Body: { to?: string; blocker?: string } }>(
    "/bff/board/tasks/:id/status", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      return handle(reply, request, () =>
        store.transitionTask(actorOf(session), request.params.id, request.body?.to as Status, request.body?.blocker));
    });

  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    "/bff/board/tasks/:id/ownership", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const action = request.body?.action;
      if (action !== "claim" && action !== "accept" && action !== "release") {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "action must be claim, accept or release" });
      }
      return handle(reply, request, () => store.setOwnership(actorOf(session), request.params.id, action));
    });

  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    "/bff/board/tasks/:id/comments", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      return handle(reply, request, () => store.addComment(actorOf(session), request.params.id, request.body?.body ?? ""));
    });

  app.put("/bff/board/profile", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return handle(reply, request, () => store.upsertProfile(actorOf(session), (request.body ?? {}) as Record<string, unknown>));
  });

  app.post<{ Body: { agentId?: string; ownerId?: string; action?: string } }>(
    "/bff/board/ownership", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const { agentId, ownerId, action } = request.body ?? {};
      if (!agentId || !ownerId || (action !== "declare" && action !== "confirm" && action !== "revoke")) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "agentId, ownerId and a valid action are required" });
      }
      return handle(reply, request, () => store.actOnOwnership(actorOf(session), agentId, ownerId, action));
    });

  app.post<{ Body: { projectId?: string; actorId?: string; action?: string; roles?: Role[] } }>(
    "/bff/board/membership", async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const { projectId, actorId, action, roles } = request.body ?? {};
      if (!projectId || !actorId || (action !== "grant" && action !== "revoke")) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "projectId, actorId and grant|revoke are required" });
      }
      return handle(reply, request, () => store.actOnMembership(actorOf(session), projectId, actorId, action, roles ?? []));
    });

  // ------------------------------------------------------------- mood boards

  app.post<{ Body: { projectId?: string; name?: string } }>("/bff/board/boards", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return handle(reply, request, () =>
      store.createBoard(actorOf(session), request.body?.projectId ?? "", request.body?.name ?? ""));
  });

  app.post<{ Params: { id: string } }>("/bff/board/boards/:id/items", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    return handle(reply, request, () => store.addBoardItem(actorOf(session), request.params.id, {
      kind: body.kind as "image" | "link" | "note" | "swatch",
      blobId: body.blobId as string | undefined,
      url: body.url as string | undefined,
      text: body.text as string | undefined,
      caption: body.caption as string | undefined,
      x: body.x as number | undefined, y: body.y as number | undefined,
      w: body.w as number | undefined, h: body.h as number | undefined,
    }));
  });

  app.patch<{ Params: { id: string } }>("/bff/board/items/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = (request.body ?? {}) as Record<string, number>;
    return handle(reply, request, () => store.moveBoardItem(actorOf(session), request.params.id, {
      x: Number(body.x ?? 0), y: Number(body.y ?? 0), w: body.w, h: body.h, z: body.z,
    }));
  });

  app.delete<{ Params: { id: string } }>("/bff/board/items/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return handle(reply, request, () => store.removeBoardItem(actorOf(session), request.params.id));
  });

  // ------------------------------------------------------------------- files

  /**
   * Upload. Raw bytes, not multipart — one content type, no parser to get
   * wrong, and the filename travels in a header where it cannot be confused
   * with the file.
   */
  app.post("/bff/board/blobs", {
    config: { rawBody: true },
    bodyLimit: MAX_BYTES + 1024,
  }, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const bytes = request.body as Buffer;
    if (!Buffer.isBuffer(bytes)) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "send the file as the raw request body" });
    }
    const filename = typeof request.headers["x-filename"] === "string"
      ? decodeURIComponent(request.headers["x-filename"])
      : undefined;
    return handle(reply, request, () =>
      blobs.put(session.username, bytes, filename, String(request.headers["content-type"] ?? "")));
  });

  app.get<{ Params: { id: string } }>("/bff/board/blobs/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    try {
      const { bytes, mime, sha256 } = blobs.read(request.params.id);
      return reply
        // Content-addressed, so the bytes at a given id can never change and
        // this is safe to cache hard.
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("etag", `"${sha256}"`)
        // Belt and braces against anything that slipped past the sniffer: the
        // browser must not sniff a type of its own, and must not run it inline.
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .type(mime)
        .send(bytes);
    } catch (error) {
      if (error instanceof Refused) {
        return reply.code(CODES[error.code] ?? 400).send({ code: error.code, error: error.message });
      }
      throw error;
    }
  });
}
