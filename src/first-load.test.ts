import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WHAT EVERY PAGE DOWNLOADS FIRST: everything src/main.tsx imports, statically,
 * all the way down. three.js (and so @react-three) belongs behind the room's
 * lazy boundary (SpacePanel's lazy Scene): on saha.ing's link its 100 KB
 * gzipped is seconds on every first visit, the board and sign-in included.
 *
 * It has crept back twice: once through main.tsx (Kerf, 2026-10-14), then
 * through the breath tones' audio context (SpacePanel -> voice-mouth ->
 * breath-sound -> engine/audio, 2026-10-21), past a test that only read
 * main.tsx. So this walks the graph. A dynamic import() is a boundary, and an
 * `import type` costs nothing; everything else counts.
 */
const src = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = /^(three|three\/.*|@react-three\/.*)$/;
const IMPORT = /^\s*import\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
const EXPORT_FROM = /^\s*export\s+(?!type\b)[^"';]*?\s+from\s+["']([^"']+)["']/gm;

function resolve(from: string, spec: string): string | null {
  const base = normalize(join(dirname(from), spec)).replace(/\.js$/, "");
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** The chain from main.tsx to the first forbidden import, or null. */
function pathToForbidden(): string[] | null {
  const start = join(src, "main.tsx");
  const cameFrom = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const specs = [...code.matchAll(IMPORT), ...code.matchAll(EXPORT_FROM)].map((m) => m[1]);
    for (const spec of specs) {
      if (FORBIDDEN.test(spec)) {
        const chain = [spec];
        for (let at: string | null = file; at; at = cameFrom.get(at) ?? null) chain.push(relative(src, at));
        return chain;
      }
      if (!spec.startsWith(".")) continue;
      const next = resolve(file, spec);
      if (next && !cameFrom.has(next)) {
        cameFrom.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

describe("every page's first download", () => {
  it("has no three.js in it: only the room loads three, behind its lazy boundary", () => {
    expect(pathToForbidden()?.join(" <- ") ?? null).toBeNull();
  });
});
