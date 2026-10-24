import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every repository file a guide names in its code (`server/space/moments.ts`, ...) exists.
 *
 * The third of doc-links and doc-commands, for the paths those miss: written in backticks rather
 * than as links. MEDITATION-ROOM told whoever builds the next piece to "copy server/space/fire.ts and
 * src/space/fire-events.ts" ten days after both were folded into moments.ts and room-events.ts
 * (2026-10-24): a builder following it finds nothing, and cannot tell the guide is what is wrong.
 *
 * docs/things/DESIGN.md is left out (it names files of phases not built yet), and so is history.
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

/**
 * Named on purpose although not here: each line that names one says why. Kept short; a path added
 * here is a sentence somewhere saying it is gone, or where else it lives.
 */
const NOT_HERE: Record<string, string> = {
  "src/space/WebPanel.tsx": "deleted with the stills renderer; ONE-ROOM and OPERATING-NOTES record that",
  "tools/board-dump.mts": "deleted with the chat-borne board; OPERATING-NOTES and ADR-002 record that",
  "src/event-core.ts": "deleted with the chat-borne board; OPERATING-NOTES records that",
  "src/space/scan-rock.ts": "lives in a patch on the meditation.ar space's branches, as SPACES.md says",
};

const code = (text: string) => [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join("\n");
const named = files.flatMap((file) =>
  [...code(readFileSync(join(root, file), "utf8"))
    .matchAll(/\b((?:src|server|shared|tools|deploy|public|docs|dev|harness)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|js|mjs|py|sh|md|json|conf|service|html|css))\b/g)]
    .map((m) => ({ file, path: m[1]! })),
);

describe("files the guides name", () => {
  it("finds plenty, so the extraction itself is not silently empty", () => {
    expect(named.length).toBeGreaterThan(100);
  });

  it("all exist, or are listed as deliberately elsewhere", () => {
    const missing = named.filter(({ path }) => !(path in NOT_HERE) && !existsSync(join(root, path))).map(({ file, path }) => `${file}: ${path}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("lists as elsewhere only what really is not here", () => {
    expect(Object.keys(NOT_HERE).filter((path) => existsSync(join(root, path)))).toEqual([]);
  });
});
