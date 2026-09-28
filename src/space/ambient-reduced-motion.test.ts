import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flameFrame } from "./EmberFire";
import { fireflyMotionTime } from "./Fireflies";
import { smokeMotionTime } from "./IncenseBowl";
import { displayMotionTime, freezeMotionTime } from "./ambient-motion";
import { candleFlameScale } from "./CandleShelf";
import { domeVisualState } from "./KaleidoscopeDome";
import { lanternDisplaySeconds } from "./Lanterns";
import { ribbonRingOpacity } from "./LightRibbons";
import { starMotionTime } from "./StarMap";

describe("reduced motion in high-salience meditation ambience", () => {
  it("holds the kaleidoscope shader and breathing field at a quiet still frame", () => {
    expect(domeVisualState(2, 0.9, true, true)).toEqual({ time: 0, breath: 0.5 });
    expect(domeVisualState(2, 0.9, true, false).time).toBe(2);
  });

  it("removes rapid flame flicker and ember drift, but leaves ordinary fire animation intact", () => {
    expect(flameFrame(1, 2, 2, true)).toEqual(flameFrame(7, 4, 2, true));
    expect(flameFrame(1, 2, 2).rotation).not.toBe(flameFrame(7, 4, 2).rotation);
  });

  it("holds smoke, stars, lanterns, and fireflies at stable times without changing their normal clocks", () => {
    for (const motionTime of [smokeMotionTime, starMotionTime, fireflyMotionTime]) {
      expect(motionTime(12, true)).toBe(0);
      expect(motionTime(12)).toBe(12);
    }
    expect(lanternDisplaySeconds(18, 12, true)).toBe(12);
    expect(lanternDisplaySeconds(18, null, true)).toBe(18);
    expect(lanternDisplaySeconds(18, 12, false)).toBe(18);
  });

  it("freezes ambient clocks at the viewer's current frame, not a jarring reset", () => {
    expect(displayMotionTime(18, 12, true)).toBe(12);
    expect(displayMotionTime(18, null, true)).toBe(18);
    expect(displayMotionTime(18, 12, false)).toBe(18);
  });

  it("clears a frozen clock when the preference turns off, then captures the new frame", () => {
    const firstFreeze = freezeMotionTime(12, null, true);
    expect(firstFreeze).toBe(12);
    expect(freezeMotionTime(18, firstFreeze, true)).toBe(12);
    const afterTurningOff = freezeMotionTime(24, firstFreeze, false);
    expect(afterTurningOff).toBeNull();
    expect(freezeMotionTime(30, afterTurningOff, true)).toBe(30);
  });

  it("stills decorative candle and movement-circle pulses while keeping their normal animation", () => {
    expect(candleFlameScale(1, 2, true)).toEqual(candleFlameScale(7, 4, true));
    expect(candleFlameScale(1, 2)).not.toEqual(candleFlameScale(7, 4));
    expect(ribbonRingOpacity(1, true)).toBe(ribbonRingOpacity(9, true));
    expect(ribbonRingOpacity(1)).not.toBe(ribbonRingOpacity(9));
  });

  it("wires the preference to the remaining ambient pieces in this pass", () => {
    const scene = readFileSync(new URL("./Scene.tsx", import.meta.url), "utf8");
    for (const component of ["EmberFire", "KaleidoscopeDome", "KoiPond", "Moon", "StarMap", "IncenseBowl", "Lanterns", "Fireflies", "PaperBoats", "CandleShelf", "LightRibbons", "BambooKnocker", "RainCurtain", "Nebula", "TeaTable"]) {
      const openingTag = scene.match(new RegExp(`<${component}\\b[^>]*>`))?.[0] ?? "";
      expect(openingTag).toContain("reducedMotion={reducedMotion}");
    }
  });
});
