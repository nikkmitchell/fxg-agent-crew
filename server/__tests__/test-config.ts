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
