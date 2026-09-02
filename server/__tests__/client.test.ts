import { afterEach, describe, expect, it, vi } from "vitest";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * These cover the retry behaviour that exists because of measured server flake:
 * roughly 1 in 8 live logins returned 401 ("签名验证失败" or "challenge 不存在或已过期")
 * and then succeeded on an immediate retry with the identical credentials.
 * Treating the first 401 as fatal would sign humans out for no reason.
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
