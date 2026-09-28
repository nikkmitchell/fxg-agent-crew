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
  it("never passes base + n before base (or base - n), the shape of the shore's old wet edge", () => {
    const dir = new URL(".", import.meta.url);
    const bad: string[] = [];
    const term = String.raw`([A-Za-z_][\w.]*)`;
    const pattern = new RegExp(String.raw`smoothstep\(\s*${term}\s*\+\s*[\d.]+\s*,\s*${term}\s*(?:-\s*[\d.]+\s*)?,`, "g");
    for (const file of readdirSync(dir).filter((name) => /\.(tsx?|glsl)$/.test(name) && !name.endsWith(".test.ts"))) {
      for (const match of readFileSync(new URL(file, dir), "utf8").matchAll(pattern)) {
        if (match[1] === match[2]) bad.push(`${file}: ${match[0]}`);
      }
    }
    expect(bad).toEqual([]);
    // The guard itself: it would have caught the old line.
    const old = "float damp = smoothstep(edge + 0.2, edge, vUv.y);";
    expect([...old.matchAll(pattern)].some((match) => match[1] === match[2])).toBe(true);
  });
});
