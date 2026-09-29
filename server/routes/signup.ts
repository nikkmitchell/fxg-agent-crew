import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CodeLimiter, isSignupChannel, registrationBody, signupProblem, type SignupForm } from "../../shared/signup.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * SIGN UP ON SAHA.ING (Nikk, 6130, 6132). See shared/signup.ts.
 *
 * POST /bff/signup/code   { channel, target }                          send a code
 * POST /bff/signup        { username, password, channel, target, code } create, then sign in
 *
 * Both only pass through to WebHarness, which owns accounts. Nothing here is
 * stored: not the password, not the code, not the address. The one piece of
 * state is the limiter, which remembers WHEN a code went out, never what.
 */
export function registerSignupRoutes(app: FastifyInstance, deps: {
  client: WebharnessClient;
  signIn: (username: string, password: string, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  limiter?: CodeLimiter;
  now?: () => number;
}): void {
  const limiter = deps.limiter ?? new CodeLimiter();
  const now = deps.now ?? Date.now;

  /** Upstream's refusal, in its own words where it gave any. */
  const refused = (reply: FastifyReply, error: unknown, request: FastifyRequest) => {
    if (error instanceof WebharnessError && error.status >= 400 && error.status < 500) {
      return reply.code(error.status === 429 ? 429 : 400).send({ code: "SIGNUP_REFUSED", error: error.detail || "WebHarness refused that." });
    }
    request.log.error({ err: error }, "sign-up upstream failed");
    return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "WebHarness could not be reached. Try again in a moment." });
  };

  /**
   * WHO IS ASKING, for the per-visitor limit. The app does not trust proxies
   * (no trustProxy), so behind nginx request.ip is 127.0.0.1 for everybody and
   * one stranger's five codes would lock out the whole world. nginx sets
   * X-Real-IP (deploy/nginx.conf); it is believed ONLY when the request came
   * from the local proxy, since anyone can send that header directly.
   */
  const visitor = (request: FastifyRequest): string => {
    const local = request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
    const real = request.headers["x-real-ip"];
    return local && typeof real === "string" && real ? real : request.ip;
  };

  app.post<{ Body: { channel?: unknown; target?: unknown } }>("/bff/signup/code", async (request, reply) => {
    const { channel, target } = request.body ?? {};
    if (!isSignupChannel(channel) || typeof target !== "string" || !target.trim() || target.length > 120) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "Choose email or phone and fill it in." });
    }
    const why = limiter.take(visitor(request), target, now());
    if (why) return reply.code(429).send({ code: "TOO_MANY_CODES", error: why });
    try {
      await deps.client.sendSignupCode(channel, target.trim());
      return reply.send({ sent: true });
    } catch (error) {
      return refused(reply, error, request);
    }
  });

  app.post<{ Body: Partial<Record<keyof SignupForm, unknown>> }>("/bff/signup", async (request, reply) => {
    const body = request.body ?? {};
    const form: SignupForm = {
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
      channel: isSignupChannel(body.channel) ? body.channel : "email",
      target: typeof body.target === "string" ? body.target : "",
      code: typeof body.code === "string" ? body.code : "",
    };
    const problem = signupProblem(form);
    if (problem) return reply.code(400).send({ code: "BAD_SIGNUP", error: problem });
    try {
      await deps.client.register(registrationBody(form));
    } catch (error) {
      return refused(reply, error, request);
    }
    // Made: now signed in exactly as /bff/login would.
    return deps.signIn(form.username.trim(), form.password, request, reply);
  });
}
