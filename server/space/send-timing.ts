import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

/**
 * WHERE A SEND'S TIME GOES, as the headset saw it. Nikk, 2026-09-26: a voice
 * send reached the room and the chat, but the headset waited 20+ seconds for
 * the answers and said "did not reach". The server answered in 0.3-3 s
 * (Nightjar, 4986), so the wait is inside the headset's browser. This is how
 * we find out where: after each send the page reports, per part, when it
 * started and when the answer came back, and whether it was in XR and
 * visible. The server writes that to its log beside its own timestamps.
 *
 * Log only: nothing stored, nothing shown to anyone. Small and bounded.
 */
type Part = { to: string; startedAt: number; answeredAt: number | null; outcome: string };

function parse(body: unknown): { parts: Part[]; inXr: boolean; visible: string } | null {
  const b = body as { parts?: unknown; inXr?: unknown; visible?: unknown } | null;
  if (!b || !Array.isArray(b.parts) || b.parts.length > 12) return null;
  const parts: Part[] = [];
  for (const raw of b.parts) {
    const p = raw as Partial<Part>;
    if (typeof p.to !== "string" || typeof p.startedAt !== "number" || typeof p.outcome !== "string") return null;
    parts.push({
      to: p.to.slice(0, 20),
      startedAt: p.startedAt,
      answeredAt: typeof p.answeredAt === "number" ? p.answeredAt : null,
      outcome: p.outcome.slice(0, 20),
    });
  }
  return { parts, inXr: b.inXr === true, visible: typeof b.visible === "string" ? b.visible.slice(0, 12) : "?" };
}

export function registerSendTimingRoutes(app: FastifyInstance, options: { config: Config; sessions: SessionStore }) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  app.post<{ Body: unknown }>("/bff/space/send-timing", { bodyLimit: 4096 }, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const timing = parse(request.body);
    if (!timing) return reply.code(400).send({ code: "BAD_TIMING", error: "not a send timing" });
    const receivedAt = Date.now();
    app.log.info({
      sendTiming: {
        who: session.username,
        inXr: timing.inXr,
        visible: timing.visible,
        // Seconds from each part's start to its answer, as the headset measured.
        parts: timing.parts.map((p) => ({ ...p, waitedS: p.answeredAt === null ? null : (p.answeredAt - p.startedAt) / 1000 })),
        // How far the headset's clock is from ours, roughly, to line up with nginx.
        reportLagS: (receivedAt - Math.max(...timing.parts.map((p) => p.answeredAt ?? p.startedAt))) / 1000,
      },
    }, "send timing");
    return reply.code(204).send();
  });
}
