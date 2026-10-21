import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the room's three.js is set where modules run (Kerf, 2026-10-14; that no page loads three first: src/first-load.test.ts)", () => {
  it("both module loaders set it before they import anything from a space", () => {
    for (const loader of ["./room-engine.ts", "./run-module.ts"]) {
      expect(source(loader).split("\n").slice(0, 5).join("\n")).toContain('import "./room-three";');
    }
    expect(source("./room-three.ts")).toContain("__SAHA_THREE__ = THREE");
  });
});
