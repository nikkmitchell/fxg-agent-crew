import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import { BoardReads } from "../db/reads.js";
import { BoardStore, Refused } from "../db/store.js";
import { BlobStore, MAX_BYTES, QUOTA_BYTES, QUOTA_FILES, orphanReport } from "../db/blobs.js";
import type { Role, Status } from "../../shared/board-rules.js";
import { makeRequireSession } from "../require-session.js";
import { pageSize, readQuestionCursor } from "../../shared/questions.js";

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
  QUOTA_EXCEEDED: 413,
  TOO_LONG: 400,
  BLOB_MISSING: 500,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  EMPTY_FILE: 400,
  BAD_URL: 400,
  OFF_THE_BOARD: 400,
  BAD_QUESTION: 400,
  NO_INTAKE: 409,
  TOO_MANY: 429,
  BAD_ANSWER: 400,
  ROLE_REQUIRED: 403,
  STALE_ANSWER: 409,
};

export function registerBoardRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  db: import("node:sqlite").DatabaseSync,
  blobRoot: string,
  observeRead?: (
    actorId: string,
    kind: "human" | "agent" | null,
    view: "tasks" | "mood",
  ) => void,
  /** When the room should show a board change: see shared/board-freshness.ts. */
  revealOf: (auditId: number, at: string, actorId: string) => string | null = (_id, at) => at,
  /** Questions asked in spaces (shared/questions.ts); without these the routes are not offered. */
  questions?: QuestionHooks,
): void {
  const reads = new BoardReads(db);
  const store = new BoardStore(db);
  const blobs = new BlobStore(db, blobRoot);

  /**
   * A lost denial must not be silent.
   *
   * The store swallows a failed denial-write so a clean refusal does not become
   * a 500 — the caller is still correctly refused. But a denial log that has
   * quietly stopped recording reads as "nobody has tried anything", which is
   * the most dangerous thing it could say.
   */
  store.onDenialWriteFailure = (error, context, code) => {
    app.log.error({ err: error, actor: context.actorId, action: context.action, code },
      "COULD NOT RECORD A DENIAL — the security audit is incomplete from here");
  };

  /**
   * Refusals per actor, so probing costs something.
   *
   * Deliberately counts REFUSALS, not requests: a member working normally never
   * touches this, and someone trying doors hits it quickly. In memory, per
   * process, and reset on restart — which is a real limit and worth naming
   * rather than implying this is a durable defence. It raises the cost of a
   * scripted probe; it does not stop a patient one.
   */
  const refusals = new Map<string, { count: number; until: number }>();
  const PROBE_LIMIT = 20;
  const PROBE_WINDOW_MS = 60_000;

  const tooManyRefusals = (actorId: string): boolean => {
    const now = Date.now();
    const entry = refusals.get(actorId);
    if (!entry || now > entry.until) return false;
    return entry.count > PROBE_LIMIT;
  };

  const countRefusal = (actorId: string) => {
    const now = Date.now();
    const entry = refusals.get(actorId);
    if (!entry || now > entry.until) {
      refusals.set(actorId, { count: 1, until: now + PROBE_WINDOW_MS });
      return;
    }
    entry.count += 1;
  };

  const requireSession = makeRequireSession(config, sessions);

  const actorOf = (session: Session) => ({ id: session.username, kind: session.kind });

  /**
   * Refusals carry their reason to the browser.
   *
   * A store refusal is a sentence written for a person — "nikk is not a member
   * of saha; treat this as a request pending a manager". Replacing it with a
   * bare 403 would throw away the only part that tells someone what to do next.
   */
  /**
   * `also` adds response fields worked out FROM the result.
   *
   * It exists for `covers`/`coveredBy` on the mood-board routes. The envelope's
   * shape — `{ ok, result }` — is relied on by src/board-client.ts, so telling
   * a caller what their item overlaps cannot be done by changing `result`.
   */
  const handle = async (
    reply: FastifyReply,
    request: FastifyRequest,
    work: () => unknown,
    also?: (result: unknown) => Record<string, unknown>,
  ) => {
    try {
      // The envelope is what was ASKED. `before`/`after` in the audit is a diff
      // of state; this is the intent behind it, and the thing a signature would
      // later attach to.
      const envelope = { method: request.method, path: request.url, body: request.body ?? null };
      const actor = sessions.get(request.cookies[config.cookieName])?.username;
      if (actor && tooManyRefusals(actor)) {
        return reply.code(429).send({
          code: "TOO_MANY_REFUSALS",
          error: "too many refused attempts in a short window; slow down",
        });
      }
      const result = store.withRequest(envelope, () => work()) ?? null;
      return reply.send({ ok: true, result, ...(also ? also(result) : {}) });
    } catch (error) {
      if (error instanceof Refused) {
        const actor = sessions.get(request.cookies[config.cookieName])?.username;
        if (actor) countRefusal(actor);
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

  app.get<{ Params: { id: string }; Querystring: { view?: string } }>("/bff/board/projects/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const requestedView = request.query.view;
    if (requestedView !== undefined && requestedView !== "tasks" && requestedView !== "mood") {
      return reply.code(400).send({
        code: "BAD_VIEW",
        error: "view must be 'tasks' or 'mood'",
      });
    }
    const view = reads.project(request.params.id);
    if (!view) return reply.code(404).send({ code: "NOT_FOUND", error: "no such project" });
    // The query is an explicit declaration of what this otherwise combined
    // payload is being read for. Only a successful authenticated read moves the
    // avatar; a typo or a missing project is not evidence of attention.
    if (requestedView) observeRead?.(session.username, session.kind ?? null, requestedView);
    // Each recently changed card says when the room should show the change.
    const tasks = view.tasks.map(({ lastChange, ...task }) =>
      lastChange
        ? {
            ...task,
            fresh: {
              changedAt: lastChange.at,
              revealAt: revealOf(lastChange.auditId, lastChange.at, lastChange.actorId),
              ...(lastChange.previousStatus ? { previousStatus: lastChange.previousStatus } : {}),
            },
          }
        : task,
    );
    return reply.send({ ...view, tasks });
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

  app.get("/bff/board/storage", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { orphans, totalBytes } = orphanReport(db);
    return reply.send({
      quota: { bytes: QUOTA_BYTES, files: QUOTA_FILES },
      usage: db.prepare("SELECT * FROM storage_usage ORDER BY bytes DESC").all(),
      // Reported, never swept. Deleting bytes on a computed reference set is
      // how you lose a file that was still in use.
      orphans: { count: orphans.length, totalBytes, files: orphans.slice(0, 100) },
    });
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
    }),
    // WHAT YOU JUST LANDED ON, and what landed on you. Nothing is moved and
    // nothing is refused; the caller is simply told, because an agent placing
    // an item cannot see the board and until now got no answer at all.
    // See store.overlapsOf for why BOTH directions are reported.
    (id) => store.overlapsOf(String(id)));
  });

  app.patch<{ Params: { id: string } }>("/bff/board/items/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = (request.body ?? {}) as Record<string, number>;
    return handle(reply, request, () => store.moveBoardItem(actorOf(session), request.params.id, {
      x: Number(body.x ?? 0), y: Number(body.y ?? 0), w: body.w, h: body.h, z: body.z,
    }),
    // Also on a MOVE, which is the case this exists for: somebody nudging an
    // item off one neighbour needs to know they have not pushed it onto
    // another, or slid it UNDER one — the second of which the first version of
    // this could not see, and which is how I buried two items twice over.
    // `moveBoardItem` returns nothing, so the id comes from the path.
    () => store.overlapsOf(request.params.id));
  });

  /**
   * What an item SAYS. Position goes through PATCH above; this is content, and
   * unlike a drag it is audited.
   */
  app.post<{ Params: { id: string }; Body: { text?: string; caption?: string } }>(
    "/bff/board/items/:id/text",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const body = request.body ?? {};
      return handle(reply, request, () =>
        store.editBoardItem(actorOf(session), request.params.id, {
          text: typeof body.text === "string" ? body.text : undefined,
          caption: typeof body.caption === "string" ? body.caption : undefined,
        }),
      );
    },
  );

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

  // --------------------------------------------------------------- questions
  //
  // Asked in a space, carded on a project's board, answered beside the card
  // (shared/questions.ts). The rules are BoardStore's like every other write;
  // what these routes add is what the board cannot know: which space the thing
  // you are standing at comes from, and who made that space.

  if (!questions) return;

  const NO_INTAKE = (space: string) => ({
    code: "NO_INTAKE",
    error: `questions asked in ${space} have nowhere to go yet: a manager of the board that answers them has to take them first`,
  });

  app.put<{ Params: { id: string }; Body: { space?: unknown } }>("/bff/board/projects/:id/question-intake", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const space = typeof request.body?.space === "string" ? request.body.space : "";
    if (!space) return reply.code(400).send({ code: "BAD_REQUEST", error: "say which space: { space }" });
    return handle(reply, request, () => {
      store.setQuestionIntake(actorOf(session), space, request.params.id, questions.creatorOf(space));
      return reads.questionIntake(space);
    });
  });

  app.delete<{ Params: { id: string }; Querystring: { space?: string } }>("/bff/board/projects/:id/question-intake", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const space = request.query.space ?? "";
    if (reads.questionIntake(space)?.projectId !== request.params.id) {
      return reply.code(404).send({ code: "NOT_FOUND", error: `questions from ${space || "that space"} do not come to ${request.params.id}` });
    }
    return handle(reply, request, () => store.setQuestionIntake(actorOf(session), space, null, questions.creatorOf(space)));
  });

  /** The space of the thing you named, in the room you are in; or a reply saying it is not one. */
  const spaceAt = (session: Session, item: unknown, reply: FastifyReply): string | null => {
    const space = typeof item === "string" && item ? questions.spaceOfItem(session, item) : null;
    if (!space) reply.code(404).send({ code: "NOT_A_THING", error: "there is no thing from a space by that id in your room" });
    return space;
  };

  app.get<{ Querystring: { item?: string; mine?: string; limit?: string; cursor?: string } }>("/bff/space/questions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const space = spaceAt(session, request.query.item, reply);
    if (!space) return reply;
    const intake = reads.questionIntake(space);
    // Fail clearly (Mica, 7322): an empty list would say "nobody has asked", not "nowhere to ask".
    if (!intake) return reply.code(409).send(NO_INTAKE(space));
    const cursor = request.query.cursor ? readQuestionCursor(request.query.cursor) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send({ code: "BAD_CURSOR", error: "that cursor is not one a page of questions gave; start again without it" });
    const page = reads.questions(space, { askedBy: request.query.mine === "1" ? session.username : undefined, limit: pageSize(request.query.limit), cursor });
    return reply.send({ space, project: intake.projectId, ...page });
  });

  app.post<{ Body: { item?: unknown; text?: unknown; requestKey?: unknown } }>("/bff/space/questions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const space = spaceAt(session, request.body?.item, reply);
    if (!space) return reply;
    return handle(reply, request, () => {
      const filed = store.fileQuestion(actorOf(session), { space, text: request.body?.text, requestKey: request.body?.requestKey });
      const { answers: _answers, ...question } = reads.question(filed.id)!;
      return { existing: filed.existing, question };
    });
  });

  app.get<{ Params: { id: string } }>("/bff/questions/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const question = reads.question(request.params.id);
    return question ? reply.send({ question }) : reply.code(404).send({ code: "NOT_FOUND", error: `no question ${request.params.id}` });
  });

  app.post<{ Params: { id: string }; Body: { body?: unknown; refs?: unknown; after?: unknown } }>("/bff/questions/:id/answers", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return handle(reply, request, () => store.answerQuestion(actorOf(session), request.params.id, {
      body: request.body?.body, refs: request.body?.refs, after: request.body?.after,
    }));
  });
}

/** What the question routes need from the rooms and spaces, which the board does not own. */
export type QuestionHooks = {
  /** The space a thing in your room comes from (its top-level item's source), or null when it is no such thing. */
  spaceOfItem(session: Session, item: string): string | null;
  /** Who made a space, or null when there is no such space. */
  creatorOf(space: string): string | null;
};
