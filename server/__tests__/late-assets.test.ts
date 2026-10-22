import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { HASHED_FOR_A_YEAR } from "../static-files.js";
import { tempDir } from "./test-config.js";

/**
 * A BUILD FILE COPIED IN AFTER THE SERVER STARTED IS SERVED. A release copies the
 * new build 10-20 s before it restarts the server; the static plugin had listed
 * dist/ at start-up, so the new index.html went out and its chunks 404'd, and
 * pages that reloaded for the update in that window were left blank (2026-10-22).
 */
describe("build files that arrived after start-up", () => {
  it("are served from disk, kept a year; anything else under /assets still 404s", async () => {
    const { app } = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("blobs-"),
      LOG_LEVEL: "silent",
    });
    await app.ready();
    const name = `late-${process.pid}-${Date.now()}.js`;
    const file = fileURLToPath(new URL(`../../dist/assets/${name}`, import.meta.url));
    writeFileSync(file, "export const late = true;\n");
    try {
      const served = await app.inject({ method: "GET", url: `/assets/${name}` });
      expect(served.statusCode).toBe(200);
      expect(served.body).toContain("late = true");
      expect(served.headers["cache-control"]).toBe(HASHED_FOR_A_YEAR);

      expect((await app.inject({ method: "GET", url: "/assets/not-there-ever.js" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/assets/..%2Findex.html" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/assets/../package.json" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/assets/${name}` })).statusCode).toBe(404);
    } finally {
      rmSync(file, { force: true });
      await app.close();
    }
  });
});
