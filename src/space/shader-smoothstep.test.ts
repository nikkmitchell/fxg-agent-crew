import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * GLSL's smoothstep(edge0, edge1, x) is undefined when edge0 >= edge1
 * (Lumenfold's review, 5699). Write a falling edge as 1.0 - smoothstep(low, high, x).
 */
describe("shader smoothstep edges", () => {
  it("never passes a larger first edge as a plain number", () => {
    const dir = new URL(".", import.meta.url);
    const bad: string[] = [];
    for (const file of readdirSync(dir).filter((name) => /\.(tsx?|glsl)$/.test(name) && !name.endsWith(".test.ts"))) {
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const match of source.matchAll(/smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g)) {
        if (Number(match[1]) >= Number(match[2])) bad.push(`${file}: ${match[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
