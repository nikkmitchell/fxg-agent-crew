import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

/**
 * WHAT BROKE ON SOMEBODY'S SCREEN, in the server log.
 *
 * The page had no error handling of any kind: an exception in the 3D scene
 * blanked it, and in a headset ended the session, and nobody but the person
 * wearing it ever knew. Every bug from the headset reached us as a sentence
 * said in the room, after the fact. The page now reports uncaught errors and
 * crashes here (src/client-errors.ts), and they are logged beside everything
 * else the server knows. Log only: nothing stored, nothing shown to anyone.
 *
 * Signed-in people only, small bodies, and at most PER_MINUTE a person, so a
 * page stuck in a loop cannot fill the disk.
 */
const PER_MINUTE = 20;
const MESSAGE_LIMIT = 500;
const STACK_LIMIT = 3000;

type Report = { message: string; stack: string | null; where: string; page: string; inXr: boolean; build: string | null };

function parse(body: unknown): Report | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.message !== "string" || !b.message.trim()) return null;
  const text = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : null);
  return {
    message: b.message.slice(0, MESSAGE_LIMIT),
    stack: text(b.stack, STACK_LIMIT),
    where: text(b.where, 40) ?? "page",
    page: text(b.page, 200) ?? "",
    inXr: b.inXr === true,
    build: text(b.build, 40),
  };
}

export function registerClientErrorRoutes(
  app: FastifyInstance,
  options: { config: Config; sessions: SessionStore; now?: () => number },
) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const now = options.now ?? Date.now;
  const recent = new Map<string, { count: number; until: number }>();

  app.post<{ Body: unknown }>("/bff/client-error", { bodyLimit: 8192 }, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const report = parse(request.body);
    if (!report) return reply.code(400).send({ code: "BAD_REPORT", error: "an error report needs a message" });

    const at = now();
    for (const [who, window] of recent) if (window.until <= at) recent.delete(who);
    const window = recent.get(session.username) ?? { count: 0, until: at + 60_000 };
    window.count += 1;
    recent.set(session.username, window);
    // Accepted either way: a page must never retry a report, or show anyone
    // that one was dropped.
    if (window.count > PER_MINUTE) return reply.code(204).send();

    app.log.warn({ clientError: { who: session.username, ...report } }, "client error");
    return reply.code(204).send();
  });
}
