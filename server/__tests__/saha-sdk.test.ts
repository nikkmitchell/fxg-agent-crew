import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { sahaSdkSource } from "../spaces/saha-sdk.js";
import { tempDir } from "./test-config.js";

async function sdk() {
  const file = join(tempDir("saha-sdk-"), "saha-sdk.mjs");
  writeFileSync(file, sahaSdkSource());
  return (await import(pathToFileURL(file).href)) as {
    defineItem: (def: unknown) => Record<string, unknown>;
    defineEnvironment: (def: unknown) => Record<string, unknown>;
    defineSpace: (def: unknown) => Record<string, unknown>;
    isThing: (value: unknown) => boolean;
  };
}

describe('"saha": what a thing imports to define itself (contract saha/1)', () => {
  it("brands a definition with its kind, so the room knows a thing from any other module", async () => {
    const { defineItem, defineEnvironment, defineSpace, isThing } = await sdk();
    const drums = defineItem({ name: "Hand drums", size: [1.9, 1, 0.7], setup() {} });
    expect(drums.kind).toBe("item");
    expect(isThing(drums)).toBe(true);
    expect(Object.isFrozen(drums)).toBe(true);
    // The room checks the brand with its own copy of the registered symbol.
    expect((drums as Record<symbol, unknown>)[Symbol.for("saha.thing")]).toBe(1);
    expect(defineEnvironment({ name: "Rain", setup() {} }).kind).toBe("environment");
    expect(defineSpace({ name: "Concert", things: {} }).kind).toBe("space");
    expect(isThing({ name: "x", setup() {} })).toBe(false);
  });

  it("explains a definition that is wrong, in the author's terms", async () => {
    const { defineItem, defineSpace } = await sdk();
    expect(() => defineItem({ setup() {} })).toThrow(/give it a name/);
    expect(() => defineItem({ name: "Drums" })).toThrow(/needs setup\(ctx\)/);
    expect(() => defineItem({ name: "Drums", size: [1, 2], setup() {} })).toThrow(/size is \[width, height, depth\]/);
    expect(() => defineSpace({ name: "Concert" })).toThrow(/needs things/);
  });
});
