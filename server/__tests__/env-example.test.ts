import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * deploy/env.example names every setting the server reads, and nothing nobody reads.
 *
 * It is what a new box is provisioned from (and saha.ing may move back to its old box). The speech
 * engines and the voice relay were configured only on the live box, with their lines documented in
 * code comments: a box built from this file would have come up with no voices, no speech to text and
 * no relay, and nothing anywhere would have said why (2026-10-24).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = (dir: string, ext: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : files(path, ext);
    return entry.name.endsWith(ext) && !entry.name.includes(".test.") ? [path] : [];
  });

/** Set by the system or by git's HTTP backend, not by whoever provisions the box. */
const NOT_SETTINGS = new Set(["NODE_ENV", "PATH", "CONTENT_LENGTH", "HTTP_CONTENT_ENCODING", "HTTP_GIT_PROTOCOL"]);

const readByServer = new Set(
  files("server", ".ts").flatMap((file) =>
    [...readFileSync(join(root, file), "utf8").matchAll(/\benv(?:\.|\[["'])([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!),
  ),
);
const readByScripts = new Set(
  files("deploy", ".sh").flatMap((file) =>
    [...readFileSync(join(root, file), "utf8").matchAll(/\$\{?([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!),
  ),
);
const example = readFileSync(join(root, "deploy/env.example"), "utf8");
/** A setting is named when it has a line of its own, commented out or not: `NAME=` or `# NAME=`. */
const named = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

describe("deploy/env.example", () => {
  it("names every setting the server reads", () => {
    expect(readByServer.size).toBeGreaterThan(10);
    expect([...readByServer].filter((name) => !NOT_SETTINGS.has(name) && !named.has(name)).sort()).toEqual([]);
  });

  it("names nothing that neither the server nor the deploy scripts read", () => {
    expect([...named].filter((name) => !readByServer.has(name) && !readByScripts.has(name)).sort()).toEqual([]);
  });
});
