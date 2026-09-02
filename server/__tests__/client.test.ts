import { afterEach, describe, expect, it, vi } from "vitest";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * These cover the retry behaviour.
 *
 * It exists because repeated logins against one deployment returned 401
 * ("签名验证失败" or "challenge 不存在或已过期") and then succeeded on an
 * immediate retry with the same credentials. The sample was never counted and
 * the CAUSE WAS NEVER ESTABLISHED — the same account later lost key
 * verification entirely, so credential or identity confusion is at least as
 * plausible as anything server-side.
 *
 * The behaviour is justified by consequence, not diagnosis: treating a first
 * 401 as fatal would sign someone out on a transient failure we have seen, and
 * one extra request is cheap — but only where repeating it is safe.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("WebharnessClient", () => {
  it("retries once on a transient 401 and returns the retry's result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { detail: "签名验证失败" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WebharnessClient("https://example.test");
    await expect(client.request("/api/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("flags reauth only after a second consecutive 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { detail: "签名验证失败" }))
      .mockResolvedValueOnce(json(401, { detail: "签名验证失败" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WebharnessClient("https://example.test");
    const error = await client.request("/api/rooms").catch((e) => e);

    expect(error).toBeInstanceOf(WebharnessError);
    expect(error.status).toBe(401);
    expect(error.reauth).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-401 failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(403, { detail: "尚未加入该房间" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WebharnessClient("https://example.test");
    const error = await client.request("/api/rooms/x").catch((e) => e);

    expect(error.status).toBe(403);
    expect(error.reauth).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the bearer token out of thrown errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { detail: "boom" })));

    const client = new WebharnessClient("https://example.test");
    const error = await client.request("/api/rooms", { token: "super-secret-token" }).catch((e) => e);

    // An error that carries the token would leak it into any log line.
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(
      "super-secret-token",
    );
  });

  it("survives a non-JSON error body from a proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    );

    const client = new WebharnessClient("https://example.test");
    const error = await client.request("/api/rooms").catch((e) => e);

    expect(error).toBeInstanceOf(WebharnessError);
    expect(error.status).toBe(502);
  });
});

/**
 * Retry eligibility. Required by review of #13, which found the comment
 * claiming "only safe-to-repeat requests are retried" while request() retried
 * every method — a documented guarantee the code did not provide, written into
 * a commit that was itself correcting an overclaim.
 */
describe("only requests that can safely repeat are retried", () => {
  /** A Response body reads once, so each call needs a fresh one. */
  const once = (status: number, body: unknown) => () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("does NOT retry an arbitrary POST on 401", async () => {
    const fetchMock = vi.fn().mockImplementation(once(401, { detail: "签名验证失败" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WebharnessClient("https://example.test");
    const error = await client
      .request("/api/rooms/x/messages", { method: "POST", body: { content: "hi" } })
      .catch((e) => e);

    // A 401 says the response was rejected, not that the server did no work.
    // Repeating a create could duplicate it, and a duplicated write is worse
    // than an extra sign-in prompt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(401);
    expect(error.reauth).toBe(true);
  });

  it.each(["PATCH", "DELETE", "PUT"])("does NOT retry %s on 401", async (method) => {
    // PUT and DELETE are idempotent in HTTP terms and still excluded: knowing
    // the end state after repeats does not tell us it is safe to resend when we
    // cannot see whether the first attempt was applied.
    const fetchMock = vi.fn().mockImplementation(once(401, { detail: "签名验证失败" }));
    vi.stubGlobal("fetch", fetchMock);

    await new WebharnessClient("https://example.test").request("/api/x", { method }).catch(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("DOES retry a GET on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(once(401, { detail: "签名验证失败" }))
      .mockImplementationOnce(once(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new WebharnessClient("https://example.test").request("/api/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a POST only when explicitly opted in", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(once(401, { detail: "签名验证失败" }))
      .mockImplementationOnce(once(200, { token: "t" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WebharnessClient("https://example.test").request("/api/login", {
      method: "POST",
      retryUnsafeOn401: true,
    });

    expect(result).toEqual({ token: "t" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("login opts in, because a rejected login leaves nothing behind", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(once(401, { detail: "签名验证失败" }))
      .mockImplementationOnce(once(200, { token: "tok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new WebharnessClient("https://example.test").login("u", "p")).resolves.toBe("tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
