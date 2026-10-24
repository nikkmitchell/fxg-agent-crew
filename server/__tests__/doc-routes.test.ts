import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { tempDir } from "./test-config.js";

/**
 * Every `METHOD /bff/...` the guides tell an agent or an operator to call is a route the server has.
 *
 * The sibling of doc-commands.test.ts. OPERATING-NOTES still described the still renderer's
 * password-less POST /bff/space/render-session as live (and how to keep it safe) weeks after the
 * route was deleted (2026-10-24): a guide naming a route that is gone is a dead end for an agent and
 * a false alarm, or false comfort, for whoever runs the box. Matched against Fastify's own route
 * table (findRoute), so a parameter is a parameter whatever the guide calls it.
 *
 * docs/things/DESIGN.md is left out: it is a design, and names routes of phases not built yet.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const markdown = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdown(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
const files = ["README.md", "public/skill.md", "tools/webharness/README.md",
  ...markdown("docs").filter((path) => !path.startsWith("docs/history") && path !== "docs/things/DESIGN.md"),
  ...markdown(".claude/skills")];

/** Code only (fenced blocks, `inline spans`, table cells in backticks): where a route is an instruction. */
const code = (text: string) => [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join("\n");

const named = files.flatMap((file) =>
  [...code(readFileSync(join(root, file), "utf8"))
    // A placeholder is one segment, however it is written: <encoded id>, {id}, :id.
    .replace(/<[^>\n]*>|\{[^}\n]*\}/g, ":x")
    .matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/bff\/[^\s`'")?#]+)/g)]
    .map((m) => ({ file, method: m[1]!, path: m[2]!.replace(/[.,;:]+$/, "") })),
);

/** Routes the guides mention only to say they were removed: they must stay removed for that to be true. */
const GONE = new Set(["POST /bff/space/render-session"]);

describe("routes the guides name", () => {
  it("finds some, so the extraction itself is not silently empty", () => {
    expect(named.length).toBeGreaterThan(20);
  });

  it("are all routes the server has", async () => {
    const { app } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: tempDir("blobs-") });
    await app.ready();
    const missing = named
      .filter(({ method, path }) => !GONE.has(`${method} ${path}`) && !app.findRoute({ method: method as "GET", url: path }))
      .map(({ file, method, path }) => `${file}: ${method} ${path}`);
    expect([...new Set(missing)]).toEqual([]);
    // And the ones described as removed really are, or the guides saying so have become the stale ones.
    expect([...GONE].filter((route) => {
      const [method, url] = route.split(" ");
      return app.findRoute({ method: method as "GET", url: url! });
    })).toEqual([]);
    await app.close();
  });
});
