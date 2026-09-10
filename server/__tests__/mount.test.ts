import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

const apps: Array<ReturnType<typeof buildServer>["app"]> = [];
const dist = resolve(import.meta.dirname, "../../dist");
let createdFixture = false;

beforeAll(() => {
  // The static-route contract needs an index file, but a clean checkout has no
  // build output. Make the test self-contained rather than passing only when a
  // developer happened to run `pnpm build` first.
  if (!existsSync(resolve(dist, "index.html"))) {
    mkdirSync(dist, { recursive: true });
    writeFileSync(resolve(dist, "index.html"), "<!doctype html><title>fixture</title>");
    createdFixture = true;
  }
});

afterAll(() => {
  if (createdFixture) rmSync(dist, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("embedded /space mount", () => {
  it("keeps classic-chat routes outside the Space service", async () => {
    const { app } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      APP_BASE_PATH: "/space",
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/space/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/space/bff/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/bff/me" })).statusCode).toBe(404);
  });

  it("reserves /api even when the app owns the root path", async () => {
    // Mission Control was mounted at /space so it could share an origin with
    // classic chat without capturing its routes. Chat moved to its own domain
    // and the mount went with it — but the reason for it did not. Without this
    // reservation the SPA fallback answers /api/anything with the app, and the
    // day something else is served from this origin it is swallowed silently.
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test" });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
    for (const url of ["/api/rooms", "/api", "/api/anything/at/all"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers["content-type"], url).not.toContain("text/html");
    }
  });

  it("does not mistake a path that merely starts with those letters", async () => {
    // /apiary is not /api. A prefix check without the boundary would 404 it.
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test" });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/apiary" })).statusCode).toBe(200);
  });

  it("404s a missing FILE instead of quietly answering with the app", async () => {
    // Found in a browser, not in a test. After a rebuild, the page asked for
    // the previous build's hashed asset; the fallback answered 200 with
    // index.html; the browser refused it — "Expected a JavaScript-or-Wasm
    // module script but the server responded with a MIME type of text/html" —
    // and rendered NOTHING. Blank page, 200 in the access log, evidence only in
    // a console nobody was watching.
    //
    // Reachable in production by any browser holding a cached index.html across
    // a deploy. A 404 is something a browser can act on; a 200 of the wrong
    // type is not.
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test", APP_BASE_PATH: "/space" });
    apps.push(app);

    for (const url of ["/space/assets/index-DEADBEEF.js", "/space/assets/style.css", "/space/favicon.ico"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers["content-type"], url).not.toContain("text/html");
    }
  });

  it("still serves the app for routes, which is what the fallback is for", async () => {
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test", APP_BASE_PATH: "/space" });
    apps.push(app);

    for (const url of ["/space/board", "/space/people", "/space/projects"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"], url).toContain("text/html");
    }
  });

  it("redirects the bare mount to its trailing-slash asset base", async () => {
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test", APP_BASE_PATH: "/space" });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/space" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/space/");
  });
});
