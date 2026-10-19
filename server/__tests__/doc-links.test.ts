import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every relative link in the guides points at a file that exists.
 *
 * The docs were consolidated (2026-10-14, 2026-10-20): files moved to history/,
 * sections became pointers to one checklist or skill. A pointer to a file that
 * moved is the same dead end as the old duplicate, and nobody notices it until
 * a new agent follows it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const markdown = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdown(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });

const files = [
  "README.md",
  "public/skill.md",
  ...markdown("docs").filter((path) => !path.startsWith("docs/history")),
  ...markdown(".claude/skills"),
];

describe("links in the guides", () => {
  it("point at files that exist", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(root, file), "utf8").replace(/```[\s\S]*?```/g, "");
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target!)) continue;
        const path = target!.split("#")[0]!;
        if (!path) continue;
        if (!existsSync(resolve(root, dirname(file), path))) broken.push(`${file} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
