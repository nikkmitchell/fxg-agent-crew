import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerSignupRoutes } from "../routes/signup.js";
import { CodeLimiter, registrationBody, signupProblem } from "../../shared/signup.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

function app(upstream: Partial<WebharnessClient> = {}) {
  const calls: Array<{ what: string; args: unknown[] }> = [];
  const client = {
    sendSignupCode: async (...args: unknown[]) => { calls.push({ what: "code", args }); },
    register: async (...args: unknown[]) => { calls.push({ what: "register", args }); },
    ...upstream,
  } as unknown as WebharnessClient;
  let clock = 1_000_000;
  const server = Fastify();
  registerSignupRoutes(server, {
    client,
    signIn: async (username, _password, _request, reply) => reply.send({ username, signedIn: true }),
    limiter: new CodeLimiter(),
    now: () => clock,
  });
  return { server, calls, tick: (ms: number) => { clock += ms; } };
}

const form = { username: "lotus", password: "calm-water", channel: "email", target: "lotus@example.com", code: "123456" };

describe("signing up on saha.ing (Nikk, 6130)", () => {
  it("creates the WebHarness account, then signs in by the ordinary path", async () => {
    const { server, calls } = app();
    const answer = await server.inject({ method: "POST", url: "/bff/signup", payload: form });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ username: "lotus", signedIn: true });
    expect(calls).toEqual([{ what: "register", args: [{ username: "lotus", password: "calm-water", email: "lotus@example.com", emailCode: "123456" }] }]);
  });

  it("puts a phone and its code under the phone names", () => {
    expect(registrationBody({ ...form, channel: "phone", target: " +86 138 0000 0000 " }))
      .toEqual({ username: "lotus", password: "calm-water", phone: "+86 138 0000 0000", phoneCode: "123456" });
  });

  it("says what is wrong before bothering WebHarness", async () => {
    const { server, calls } = app();
    for (const bad of [{ username: "x" }, { username: "two words" }, { password: "abc" }, { target: "not-an-email" }, { code: " " }]) {
      const answer = await server.inject({ method: "POST", url: "/bff/signup", payload: { ...form, ...bad } });
      expect(answer.statusCode).toBe(400);
      expect(answer.json().code).toBe("BAD_SIGNUP");
    }
    expect(calls).toEqual([]);
    expect(signupProblem({ ...form, username: "莲花" })).toBeNull();
  });

  it("shows WebHarness's own refusal, and does not sign in", async () => {
    const { server } = app({ register: async () => { throw new WebharnessError(400, "username taken"); } });
    const answer = await server.inject({ method: "POST", url: "/bff/signup", payload: form });
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toEqual({ code: "SIGNUP_REFUSED", error: "username taken" });
  });

  it("sends a code, but not twice a minute to one address nor six times an hour from one visitor", async () => {
    const { server, calls, tick } = app();
    const send = (target: string) => server.inject({ method: "POST", url: "/bff/signup/code", payload: { channel: "email", target } });
    expect((await send("a@example.com")).statusCode).toBe(200);
    expect(calls[0]).toEqual({ what: "code", args: ["email", "a@example.com"] });
    expect((await send("A@example.com")).statusCode).toBe(429);
    tick(61_000);
    expect((await send("a@example.com")).statusCode).toBe(200);
    for (const n of [1, 2, 3]) expect((await send(`b${n}@example.com`)).statusCode).toBe(200);
    const sixth = await send("c@example.com");
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe("TOO_MANY_CODES");
  });

  it("counts visitors by nginx's X-Real-IP, so one stranger cannot lock everybody out", async () => {
    const { server } = app();
    const send = (who: string, n: number) => server.inject({ method: "POST", url: "/bff/signup/code", headers: { "x-real-ip": who }, payload: { channel: "email", target: `${who}-${n}@example.com` } });
    for (const n of [1, 2, 3, 4, 5]) expect((await send("203.0.113.1", n)).statusCode).toBe(200);
    expect((await send("203.0.113.1", 6)).statusCode).toBe(429);
    expect((await send("198.51.100.7", 1)).statusCode).toBe(200);
  });

  it("refuses a code request with no address", async () => {
    const { server, calls } = app();
    const answer = await server.inject({ method: "POST", url: "/bff/signup/code", payload: { channel: "fax", target: "" } });
    expect(answer.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});
