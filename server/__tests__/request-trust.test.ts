import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { trustsSession } from "../request-trust.js";
import { tempDir } from "./test-config.js";

const browser = (site: string, extra: Record<string, string> = {}) => ({ host: "saha.ing", "sec-fetch-site": site, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", ...extra });

describe("whose request keeps the sign-in", () => {
  it("saha.ing's own pages, and a visit typed or bookmarked", () => {
    expect(trustsSession(browser("same-origin", { origin: "https://saha.ing" }), "POST")).toBe(true);
    expect(trustsSession(browser("same-origin", { "sec-fetch-mode": "websocket", "sec-fetch-dest": "websocket", origin: "https://saha.ing" }), "GET")).toBe(true);
    expect(trustsSession(browser("none", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }), "GET")).toBe(true);
  });

  it("a link followed here from anywhere, the way a space's door reaches /go/<space>", () => {
    const visit = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
    expect(trustsSession(browser("cross-site", visit), "GET")).toBe(true);
    expect(trustsSession(browser("same-site", visit), "GET")).toBe(true);
  });

  it("not a script on another page, even one on a saha.ing subdomain (Lax lets that through)", () => {
    expect(trustsSession(browser("same-site", { origin: "https://spaces.saha.ing" }), "POST")).toBe(false);
    expect(trustsSession(browser("same-site", { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" }), "GET")).toBe(false);
    expect(trustsSession(browser("cross-site", { "sec-fetch-mode": "websocket", "sec-fetch-dest": "websocket", origin: "https://evil.example" }), "GET")).toBe(false);
  });

  it("not a form posted from elsewhere, nor another page framing a saha.ing page", () => {
    expect(trustsSession(browser("same-site", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", origin: "https://spaces.saha.ing" }), "POST")).toBe(false);
    expect(trustsSession(browser("same-site", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }), "GET")).toBe(false);
  });

  it("never an opaque origin: a sandboxed space page, or a live piece's worker", () => {
    expect(trustsSession(browser("cross-site", { origin: "null" }), "POST")).toBe(false);
    expect(trustsSession({ host: "saha.ing", origin: "null" }, "GET")).toBe(false);
  });

  it("from a browser too old for Sec-Fetch-Site, by the Origin it names", () => {
    expect(trustsSession({ host: "saha.ing", origin: "https://saha.ing" }, "POST")).toBe(true);
    expect(trustsSession({ host: "saha.ing", origin: "https://spaces.saha.ing" }, "POST")).toBe(false);
    expect(trustsSession({ host: "saha.ing", origin: "not a url" }, "POST")).toBe(false);
  });

  it("agents' tools and tests, which send a cookie and nothing a browser adds", () => {
    expect(trustsSession({ host: "saha.ing", cookie: "fxg_sid=x" }, "POST")).toBe(true);
    // Node's own fetch says its mode, never its site.
    expect(trustsSession({ host: "saha.ing", "sec-fetch-mode": "cors" }, "POST")).toBe(true);
  });
});

describe("the server serves another page's request as nobody's", () => {
  const boot = () => {
    const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: tempDir("blobs-"), LOG_LEVEL: "silent" });
    const cookie = `${built.config.cookieName}=${built.sessions.create("Nikk2", "t", "human")}`;
    const hold = (headers: Record<string, string>) =>
      built.app.inject({ method: "POST", url: "/bff/space/holds", headers: { cookie, host: "saha.ing", ...headers }, payload: { thing: "panel:said", held: true } });
    return { ...built, hold };
  };

  it("keeps the sign-in for saha.ing's own page and for a tool", async () => {
    const { app, hold } = boot();
    expect((await hold({ "sec-fetch-site": "same-origin", origin: "https://saha.ing" })).statusCode).toBe(200);
    expect((await hold({})).statusCode).toBe(200);
    await app.close();
  });

  it("drops it for a page on another saha.ing host, and for a sandboxed page or piece", async () => {
    const { app, hold } = boot();
    expect((await hold({ "sec-fetch-site": "same-site", origin: "https://spaces.saha.ing" })).statusCode).toBe(401);
    expect((await hold({ "sec-fetch-site": "cross-site", origin: "null" })).statusCode).toBe(401);
    await app.close();
  });
});
