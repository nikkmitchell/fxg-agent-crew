import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MindfulnessPanel.tsx", import.meta.url), "utf8");

describe("the mindfulness panel's XR hover", () => {
  it("stops the pointer ray before updating its own hover target", () => {
    const handler = source.match(/onPointerMove=\{\(event\) => \{([\s\S]*?)\}\}/)?.[1] ?? "";
    expect(handler).toContain("event.stopPropagation()");
    expect(handler.indexOf("event.stopPropagation()")).toBeLessThan(handler.indexOf("pointTarget(event)"));
  });
});
