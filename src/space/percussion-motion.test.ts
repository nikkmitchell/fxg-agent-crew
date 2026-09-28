import { describe, expect, it } from "vitest";
import { gongVisual, singingBowlVisual } from "./percussion-motion";

describe("reduced-motion percussion visuals", () => {
  it("keeps a struck bowl still with steady, non-pulsing feedback", () => {
    expect(singingBowlVisual(0.6, 440, 1, true)).toEqual({ glow: 0.28, scale: 1 });
    expect(singingBowlVisual(0, 440, 99, true)).toEqual({ glow: 0, scale: 1 });
  });

  it("keeps a struck gong still with steady feedback", () => {
    expect(gongVisual(0.6, 1, true)).toEqual({ glow: 0.25, rotationX: 0, rotationZ: 0 });
    expect(gongVisual(0, 99, true)).toEqual({ glow: 0, rotationX: 0, rotationZ: 0 });
  });

  it("preserves the existing animated feedback when reduced motion is off", () => {
    const bowl = singingBowlVisual(0.6, 440, 1, false);
    expect(bowl.glow).toBeCloseTo(0.168);
    expect(bowl.scale).toBeCloseTo(1 + Math.sin(22) * 0.0024);

    const gong = gongVisual(0.6, 1, false);
    expect(gong.glow).toBeCloseTo(0.15);
    expect(gong.rotationX).toBeCloseTo(Math.sin(7) * 0.0072);
    expect(gong.rotationZ).toBeCloseTo(Math.sin(5.3) * 0.006);
  });
});
