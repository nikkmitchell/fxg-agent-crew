import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAgentRoutes } from "../routes/agents.js";
import { publicKeyProblem, summariseAgents } from "../../shared/agents.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";
import type { Session } from "../session.js";

const PUBLIC = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=
-----END PUBLIC KEY-----`;
const PRIVATE_LOOKING = `-----BEGIN ${"PRIVATE"} KEY-----
MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC
-----END ${"PRIVATE"} KEY-----`;

function app(signedIn = true, upstream: Partial<WebharnessClient> = {}) {
  const calls: unknown[][] = [];
  const client = {
    agents: async (token: string) => { calls.push(["list", token]); return { agents: [{ username: "Sill", status: "online" }, { username: "Moraine", status: "offline" }, { nope: 1 }] }; },
    createAgent: async (...args: unknown[]) => { calls.push(["create", ...args]); },
    ...upstream,
  } as unknown as WebharnessClient;
  const server = Fastify();
  registerAgentRoutes(server, {
    client,
    requireSession: (_request, reply) => {
      if (signedIn) return { username: "Nikk2", token: "nikk-token" } as Session;
      reply.code(401).send({ code: "SESSION_EXPIRED" });
      return undefined;
    },
  });
  return { server, calls };
}

describe("making and listing your agents on saha.ing (Nikk, 6130)", () => {
  it("registers an agent under the signed-in person, from its public key only", async () => {
    const { server, calls } = app();
    const answer = await server.inject({ method: "POST", url: "/bff/agents", payload: { username: " Fernlight ", publicKey: `\n${PUBLIC}\n` } });
    expect(answer.statusCode).toBe(200);
    expect(calls).toEqual([["create", "nikk-token", "Fernlight", PUBLIC]]);
  });

  it("refuses a PRIVATE key outright and sends nothing anywhere", async () => {
    const { server, calls } = app();
    const answer = await server.inject({ method: "POST", url: "/bff/agents", payload: { username: "Fernlight", publicKey: PRIVATE_LOOKING } });
    expect(answer.statusCode).toBe(400);
    expect(answer.json().error).toMatch(/PRIVATE key/);
    expect(calls).toEqual([]);
  });

  it("refuses a half-pasted key and a bad name before asking WebHarness", async () => {
    const { server, calls } = app();
    for (const payload of [{ username: "Fernlight", publicKey: "MCowBQYDK2VwAyEA" }, { username: "two words", publicKey: PUBLIC }]) {
      expect((await server.inject({ method: "POST", url: "/bff/agents", payload })).statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(publicKeyProblem(PUBLIC)).toBeNull();
  });

  it("lists your agents, online first by name, and drops anything malformed", async () => {
    const { server } = app();
    const answer = await server.inject({ method: "GET", url: "/bff/agents" });
    expect(answer.json()).toEqual({ agents: [{ username: "Moraine", online: false }, { username: "Sill", online: true }] });
    expect(summariseAgents(null)).toEqual([]);
  });

  it("needs you signed in", async () => {
    const { server, calls } = app(false);
    expect((await server.inject({ method: "GET", url: "/bff/agents" })).statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it("passes on WebHarness's own refusal, such as a taken name", async () => {
    const { server } = app(true, { createAgent: async () => { throw new WebharnessError(409, "username already exists"); } });
    const answer = await server.inject({ method: "POST", url: "/bff/agents", payload: { username: "Sill", publicKey: PUBLIC } });
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toEqual({ code: "AGENT_REFUSED", error: "username already exists" });
  });
});
