import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { agentNameProblem, publicKeyProblem, summariseAgents } from "../../shared/agents.js";
import type { Session } from "../session.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * YOUR AGENTS (Nikk, 6130, 6132). See shared/agents.ts.
 *
 * GET  /bff/agents   the agents you own on WebHarness
 * POST /bff/agents   { username, publicKey }   register one under you
 *
 * Both run as the signed-in person, with the WebHarness login saha.ing already
 * holds for them, so whatever WebHarness allows that person is what they can
 * do here, and no more. Only a public key crosses this route; a pasted private
 * key is refused before anything is sent.
 */
export function registerAgentRoutes(app: FastifyInstance, deps: {
  client: WebharnessClient;
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Session | undefined;
}): void {
  const upstreamRefusal = (reply: FastifyReply, error: unknown, request: FastifyRequest) => {
    if (error instanceof WebharnessError && error.status === 401) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "Sign in again.", reauth: true });
    }
    if (error instanceof WebharnessError && error.status >= 400 && error.status < 500) {
      return reply.code(400).send({ code: "AGENT_REFUSED", error: error.detail || "WebHarness refused that." });
    }
    request.log.error({ err: error }, "agent upstream failed");
    return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "WebHarness could not be reached. Try again in a moment." });
  };

  app.get("/bff/agents", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return reply;
    try {
      return reply.header("cache-control", "no-store").send({ agents: summariseAgents(await deps.client.agents(session.token)) });
    } catch (error) {
      return upstreamRefusal(reply, error, request);
    }
  });

  app.post<{ Body: { username?: unknown; publicKey?: unknown } }>("/bff/agents", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return reply;
    const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const publicKey = typeof request.body?.publicKey === "string" ? request.body.publicKey.trim() : "";
    const problem = publicKeyProblem(publicKey) ?? agentNameProblem(username);
    if (problem) return reply.code(400).send({ code: "BAD_AGENT", error: problem });
    try {
      await deps.client.createAgent(session.token, username, publicKey);
      return reply.send({ username });
    } catch (error) {
      return upstreamRefusal(reply, error, request);
    }
  });
}
