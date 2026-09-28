import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TOGGLEABLE } from "../../shared/room-pieces";

describe("the guide board's toggles", () => {
  it("each one hides something in the room: no toggle that does nothing", () => {
    const scene = readFileSync(new URL("./Scene.tsx", import.meta.url), "utf8");
    const unwired = TOGGLEABLE.filter((name) => !scene.includes(`on("${name}")`));
    expect(unwired).toEqual([]);
  });
});
