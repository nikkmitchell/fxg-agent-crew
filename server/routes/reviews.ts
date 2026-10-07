import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { BoardReads } from "../db/reads.js";
import { BoardStore, Refused } from "../db/store.js";
import type { SpaceStore } from "../spaces/store.js";
import { makeRequireSession } from "../require-session.js";
import { isRequestKey } from "../../shared/questions.js";
import { REVIEW_LIMITS, findingText, readPageCursor, readRound } from "../../shared/reviews.js";

/**
 * REVIEW ROUNDS over HTTP (shared/reviews.ts; Review Studio, Mica 7347).
 *
 * The rules are the board's (BoardStore.publishRound) and the spaces' (an
 * exact, ready deploy that has the thing in it). What these add is the joining:
 * a round's target is checked against the real deploy before a card is made,
 * and a finding is filed at the deploy that was reviewed, never at whatever
 * the branch serves now.
 */
export function registerReviewRoutes(app: FastifyInstance, deps: { config: Config; sessions: SessionStore; db: import("node:sqlite").DatabaseSync; spaces: SpaceStore }): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const store = new BoardStore(deps.db);
  const reads = new BoardReads(deps.db);
  const STATUS: Record<string, number> = { PROJECT_PERMISSION_REQUIRED: 403, ROLE_REQUIRED: 403, NOT_FOUND: 404, TOO_LONG: 400 };

  /** An exact deploy of this space, ready, with this thing in it; or why not. */
  const target = (space: string, deploy: string, entry: string): string | null => {
    const found = deps.spaces.deploy(deploy);
    if (!found || found.space !== space) return `${space} has no deploy ${deploy}`;
    if (found.status !== "ready") return `${deploy} is ${found.status}, not ready`;
    if (!(found.pieces ?? []).some((piece) => piece.id === entry)) return `${deploy} does not list ${entry} in saha-pieces.json`;
    return null;
  };

  app.post("/bff/reviews", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const read = readRound(request.body);
    if ("problem" in read) return reply.code(400).send({ code: "BAD_ROUND", error: read.problem });
    const round = read.round;
    const requestKey = (request.body as { requestKey?: unknown } | null)?.requestKey;
    if (requestKey !== undefined && !isRequestKey(requestKey)) return reply.code(400).send({ code: "BAD_ROUND", error: "requestKey is the form's key: 8 to 100 letters, digits, - and _" });
    for (const deploy of round.baseline ? [round.candidate, round.baseline] : [round.candidate]) {
      const wrong = target(round.space, deploy, round.entry);
      if (wrong) return reply.code(409).send({ code: "NO_DEPLOY", error: wrong });
    }
    try {
      const made = store.withRequest({ method: request.method, path: request.url, body: request.body ?? null }, () =>
        store.publishRound({ id: session.username, kind: session.kind }, round, (requestKey as string | undefined) ?? null));
      return reply.code(made.existing ? 200 : 201).send({ existing: made.existing, round: reads.round(made.id) });
    } catch (error) {
      if (error instanceof Refused) return reply.code(STATUS[error.code] ?? 400).send({ code: error.code, error: error.message });
      throw error;
    }
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/bff/reviews", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const cursor = request.query.cursor ? readPageCursor(request.query.cursor) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send({ code: "BAD_CURSOR", error: "that cursor is not one a page of rounds gave" });
    const page = reads.rounds({ cursor, limit: Number(request.query.limit) || undefined });
    return reply.send({ rounds: page.items, next: page.next });
  });

  app.get<{ Params: { id: string } }>("/bff/reviews/:id", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    const round = reads.round(request.params.id);
    return round ? reply.send({ round }) : reply.code(404).send({ code: "NOT_FOUND", error: `no review round ${request.params.id}` });
  });

  app.post<{ Params: { id: string }; Body: { variant?: unknown; text?: unknown; requestKey?: unknown } }>("/bff/reviews/:id/findings", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const round = reads.round(request.params.id);
    if (!round) return reply.code(404).send({ code: "NOT_FOUND", error: `no review round ${request.params.id}` });
    if (round.card.status === "done") return reply.code(409).send({ code: "ROUND_CLOSED", error: "that round is done; its findings are kept, but it takes no more" });
    const variant = request.body?.variant;
    if (variant !== "candidate" && variant !== "baseline") return reply.code(400).send({ code: "BAD_FINDING", error: 'variant is "candidate" or "baseline"' });
    if (variant === "baseline" && !round.baseline) return reply.code(400).send({ code: "BAD_FINDING", error: "this round has no baseline" });
    const text = findingText(request.body?.text);
    if ("problem" in text) return reply.code(400).send({ code: "BAD_FINDING", error: text.problem });
    if (!isRequestKey(request.body?.requestKey)) return reply.code(400).send({ code: "BAD_FINDING", error: "a finding needs the request key of the panel it was written in" });
    const at = new Date();
    const since = new Date(at.getTime() - 3_600_000).toISOString();
    if (deps.spaces.findingsSince(round.id, session.username, since) >= REVIEW_LIMITS.perHour) {
      return reply.code(429).send({ code: "TOO_MANY", error: "that is a lot of findings in an hour on one round; try again later" });
    }
    const deploy = variant === "baseline" ? round.baseline!.deploy : round.candidate.deploy;
    // The version must still be there and ready: evidence about something nobody can open is not filed (Mica 7405).
    const gone = target(round.space, deploy, round.entry);
    if (gone) return reply.code(409).send({ code: "NO_DEPLOY", error: gone });
    const filed = deps.spaces.addFinding({
      id: randomBytes(9).toString("base64url"), round: round.id, space: round.space, by: session.username, variant, deploy,
      text: text.text, requestKey: request.body!.requestKey as string, at: at.toISOString(),
    });
    const finding = deps.spaces.findings(round.id, { limit: REVIEW_LIMITS.page.max, cursor: null }).items.find((one) => one.id === filed.id)
      ?? { id: filed.id, round: round.id, by: session.username, at: at.toISOString(), variant, deploy, text: text.text };
    return reply.send({ existing: filed.existing, finding });
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/bff/reviews/:id/findings", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    if (!reads.round(request.params.id)) return reply.code(404).send({ code: "NOT_FOUND", error: `no review round ${request.params.id}` });
    const cursor = request.query.cursor ? readPageCursor(request.query.cursor) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send({ code: "BAD_CURSOR", error: "that cursor is not one a page of findings gave" });
    const limit = Math.max(1, Math.min(REVIEW_LIMITS.page.max, Number(request.query.limit) || REVIEW_LIMITS.page.default));
    const page = deps.spaces.findings(request.params.id, { limit, cursor });
    return reply.send({ findings: page.items, next: page.next });
  });
}
