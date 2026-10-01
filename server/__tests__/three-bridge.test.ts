import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { threeBridgeSource } from "../spaces/three-bridge.js";
import { tempDir } from "./test-config.js";

describe("the three.js bridge: a module's `import \"three\"` is the room's own copy", () => {
  it("hands out every export of the room's three.js, the very same objects", async () => {
    const file = join(tempDir("bridge-"), "three-bridge.mjs");
    writeFileSync(file, threeBridgeSource());
    const room = { ...THREE, Mesh: class RoomMesh {} };
    (globalThis as { __SAHA_THREE__?: unknown }).__SAHA_THREE__ = room;
    try {
      const bridged = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      expect(bridged.Mesh).toBe(room.Mesh);
      expect(bridged.Vector3).toBe(THREE.Vector3);
      expect(bridged.default).toBe(room);
      const missing = Object.keys(THREE).filter((name) => !(name in bridged));
      expect(missing).toEqual([]);
    } finally {
      delete (globalThis as { __SAHA_THREE__?: unknown }).__SAHA_THREE__;
    }
  });

  it("says what is wrong when a page that is not the room uses it", async () => {
    const file = join(tempDir("bridge-"), "three-bridge.mjs");
    writeFileSync(file, threeBridgeSource());
    await expect(import(pathToFileURL(file).href)).rejects.toThrow(/saha\.ing room's three\.js/);
  });
});
