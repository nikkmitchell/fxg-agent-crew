import { describe, expect, it } from "vitest";
import { SCREEN_ROW, captureSize, screenPlacement, screenSize } from "./screens";

describe("where shared screens hang", () => {
  it("puts a single screen straight ahead", () => {
    const one = screenPlacement(0, 1);
    expect(one.position.x).toBeCloseTo(0, 6);
    expect(one.rotationY).toBeCloseTo(0, 6);
  });

  it("keeps every screen clear of the panels beneath it", () => {
    // Panels are 2.5 m tall centred at 1.65 m: top edge 2.9 m. A screen that
    // covered a board would trade one piece of information for another.
    const bottom = SCREEN_ROW.y - SCREEN_ROW.maxHeight / 2;
    expect(bottom).toBeGreaterThan(2.9);
  });

  it("keeps neighbouring screens from overlapping, however many people share", () => {
    for (const count of [2, 3, 6, 10]) {
      for (let i = 0; i + 1 < count; i += 1) {
        const a = screenPlacement(i, count).position;
        const b = screenPlacement(i + 1, count).position;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i} of ${count}`).toBeGreaterThan(SCREEN_ROW.width);
      }
    }
  });

  it("turns every screen to face the middle of the room", () => {
    // A plane faces +z rotated by rotationY; its normal must point at the focus.
    for (let i = 0; i < 5; i += 1) {
      const { position, rotationY } = screenPlacement(i, 5);
      const normal = { x: Math.sin(rotationY), z: Math.cos(rotationY) };
      const toFocus = { x: SCREEN_ROW.focus.x - position.x, z: SCREEN_ROW.focus.z - position.z };
      const length = Math.hypot(toFocus.x, toFocus.z);
      expect(normal.x * (toFocus.x / length) + normal.z * (toFocus.z / length)).toBeCloseTo(1, 6);
    }
  });
});

describe("the shape of a shared screen", () => {
  it("never stretches the picture", () => {
    for (const [w, h] of [[1280, 720], [1280, 800], [720, 1280], [3440, 1440], [800, 800]]) {
      const size = screenSize(w, h);
      expect(size.width / size.height).toBeCloseTo(w / h, 6);
      expect(size.width).toBeLessThanOrEqual(SCREEN_ROW.width + 1e-9);
      expect(size.height).toBeLessThanOrEqual(SCREEN_ROW.maxHeight + 1e-9);
    }
  });

  it("captures inside 1280x720 without stretching or enlarging", () => {
    expect(captureSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(captureSize(2560, 1600)).toEqual({ width: 1152, height: 720 });
    expect(captureSize(640, 480)).toEqual({ width: 640, height: 480 });
    const tall = captureSize(1080, 1920);
    expect(tall.height).toBe(720);
    expect(tall.width / tall.height).toBeCloseTo(1080 / 1920, 2);
  });
});
