import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faceFrontZOf, faceRoomYaw, posesMirrored } from "./vrm-facing";

const body = (metaVersion: "0" | "1", stated?: number) =>
  ({ meta: { metaVersion }, lookAt: stated === undefined ? null : { faceFront: { z: stated } } }) as never;

describe("which way a VRM body faces", () => {
  it("takes the file's own word, else its version: VRM 0 faces -Z, VRM 1 faces +Z", () => {
    expect(faceFrontZOf(body("0"))).toBe(-1);
    expect(faceFrontZOf(body("1"))).toBe(1);
    expect(faceFrontZOf(body("1", -1))).toBe(-1);
  });

  it("turns a VRM 1 body half round so it faces the room's -Z", () => {
    expect(faceRoomYaw(faceFrontZOf(body("1")))).toBe(Math.PI);
    expect(faceRoomYaw(faceFrontZOf(body("0")))).toBe(0);
  });

  it("mirrors poses on a VRM 1 body, whose arms otherwise rise instead of hanging (Mica, 6861)", () => {
    expect(posesMirrored(body("1"))).toBe(true);
    expect(posesMirrored(body("0"))).toBe(false);
  });

  it("is the one copy: the space kit's figures use it rather than their own", () => {
    // The kit had its own faceFrontZOf and never got the VRM 1 arm fix.
    const kit = readFileSync(new URL("../kit/figures.ts", import.meta.url), "utf8");
    expect(kit).toContain('from "../space/vrm-facing"');
    expect(kit).not.toMatch(/function faceFrontZOf/);
    expect(kit).toMatch(/posesMirrored\(vrm\)/);
  });
});
