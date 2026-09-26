import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import type { Config } from "../config.js";

/**
 * A whole Config for route tests. Four tests each wrote the five fields they
 * cared about and left the rest out, which only "worked" because nothing
 * typechecked the tests: a route that started reading `blobRoot` would have
 * read undefined in a test and a path in production.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    webharnessUrl: "https://example.test",
    port: 0,
    cookieName: "fxg_sid",
    sessionTtlMs: 60_000,
    secureCookies: false,
    sessionStorePath: ":memory:",
    projectMutators: [],
    databasePath: ":memory:",
    blobRoot: "",
    logLevel: "silent",
    bodyCacheRoot: "",
    speechCacheRoot: "",
    ...overrides,
  };
}

/**
 * A fresh, writable directory for one test, under the OS's own temp folder,
 * removed when the file's tests finish (saha-ing-8175ca0a).
 *
 * Tests wrote `/tmp/blobs-<random>` by hand: on Windows that is C:\tmp, which
 * does not exist, so hundreds of tests failed for a reason that had nothing to
 * do with the app; and on every platform nothing ever removed them.
 */
const made: string[] = [];
export function tempDir(prefix = "saha-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
