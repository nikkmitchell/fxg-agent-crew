import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing in the UI may still write through the retired path.
 *
 * ADR-002 moved board writes to /bff/board/*. `POST /bff/project-events` posts
 * a crew-event fence into a chat room, which since the cutover does NOTHING —
 * the request succeeds, the message lands, and the board never sees it.
 *
 * I found one of these by accident, days after the cutover: the People surface
 * was still publishing profile edits and ownership claims as fences. Every one
 * of them would have appeared to work. That is precisely the failure the
 * legacy detector was built to catch in other agents, sitting unnoticed in our
 * own interface — which is a good argument for a test rather than a habit.
 */

const root = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", "dist-server", ".git", "__tests__", "harness"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Code, not prose — a comment explaining the retirement is not a violation. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("the retired write path", () => {
  it("is not used by any browser source", () => {
    const offenders = sources(resolve(root, "src"))
      .filter((file) => code(file).includes("bff/project-events"))
      .map((file) => relative(root, file));

    expect(offenders, "these still post crew-event fences, which do nothing since the cutover")
      .toEqual([]);
  });

  it("finds sources to scan, so a pass means something", () => {
    // The guard against the guard: a scan that found no files would pass
    // silently forever.
    expect(sources(resolve(root, "src")).length).toBeGreaterThan(10);
  });

  it("still permits the words in a comment", () => {
    // The point is capability, not vocabulary. If this ever fails, the stripper
    // has become strict enough that people will delete the explanation instead
    // of keeping the rule.
    expect(stripComments("// we used to post to bff/project-events\nconst x = 1;")).not.toContain("project-events");
  });
});
