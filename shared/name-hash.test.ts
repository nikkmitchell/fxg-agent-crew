import { describe, expect, it } from "vitest";
import { colourHash, nameHash } from "./name-hash.js";

describe("nameHash", () => {
  it("gives every name the value it has always had, so nobody's voice, desk or colours move", () => {
    // Pinned from the copies it replaced (2026-10-21). If one of these changes,
    // everybody's derived voice, desk and avatar change with it.
    expect(nameHash("")).toBe(2_166_136_261);
    expect(nameHash("sill")).toBe(281_926_417);
    expect(nameHash("Nikk2")).toBe(2_704_155_628);
    expect(nameHash("公开房001")).toBe(3_467_045_393);
    expect(nameHash("a😀b")).toBe(4_199_728_243);
  });
});

describe("colourHash", () => {
  it("keeps everybody's colour and every door's colour where it was, whatever the capitals", () => {
    expect(colourHash("sill")).toBe(colourHash("Sill"));
    expect(colourHash("sill")).toBe(3_530_326);
    expect(colourHash("saha.ing")).toBe(colourHash("SAHA.ING"));
  });
});
