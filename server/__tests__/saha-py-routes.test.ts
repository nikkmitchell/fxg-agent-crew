import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

/**
 * EVERY REQUEST saha.py MAKES IS ONE THE SERVER ANSWERS. tools/webharness/saha_py_check.py
 * runs saha.py against a fake server that answers a path whatever the method, so a
 * call with the wrong method or a path the server renamed would pass there and
 * fail for every agent. This reads saha.py's literal calls and asks the real
 * server, signed out: a route that exists refuses (401, 400); one that does not
 * is a 404 or the app's own page.
 */
const source = readFileSync(fileURLToPath(new URL("../../public/saha.py", import.meta.url)), "utf8");
const calls = [...source.matchAll(/\b(?:call|request|fetch)\("(GET|POST|PUT|PATCH|DELETE)", (f?)"([^"]+)"/g)]
  .map(([, method, isF, path]) => ({ method: method!, path: isF ? path!.replace(/^\{SITE\}/, "") : path! }))
  // WebHarness's own API and static files are not this server's routes.
  .filter(({ path }) => path.startsWith("/bff/"))
  .map(({ method, path }) => ({
    method,
    // An f-string's {…} is one path segment; a trailing {query} or ?… is the query.
    url: path.replace(/\{query\}$/, "").replace(/\{[^}]+\}/g, "x").replace(/\?.*$/, ""),
  }));

describe("saha.py asks only for routes the server has", () => {
  it("found its calls", () => {
    expect(calls.length).toBeGreaterThan(40);
  });

  it("each one is a route, with that method", async () => {
    const { app } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("blobs-"),
      LOG_LEVEL: "silent",
    });
    const missing: string[] = [];
    for (const { method, url } of calls) {
      const response = await app.inject({ method: method as "GET", url, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      const html = String(response.headers["content-type"] ?? "").includes("text/html");
      if (response.statusCode === 404 || response.statusCode === 405 || html) missing.push(`${method} ${url} -> ${response.statusCode}`);
    }
    await app.close();
    expect(missing).toEqual([]);
  });
});
