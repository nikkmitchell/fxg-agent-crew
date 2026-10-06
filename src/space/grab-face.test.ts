import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PANEL } from "../../shared/space-layout.js";

/**
 * THE THING YOU GRAB MUST BE THE SIZE OF THE THING YOU ARE GRABBING.
 *
 * `Movable` draws an invisible face over an unlocked panel so the panel itself
 * is the handle. It had its own hardcoded numbers — 4.0 x 2.6 hung 0.6 above
 * centre — while a panel is `PANEL`, 4.0 x 2.5 centred on its origin. Wrong at
 * both ends: it missed the bottom fifth, so dragging worked in the top of a
 * panel and did nothing lower down, which reads as intermittent rather than as
 * a bug; and it reached above the panel across the drag bar, stealing presses
 * meant for it.
 *
 * ASSERTED ON THE SOURCE, like `label-aspect.test.ts` and for the same reason:
 * this suite has no renderer, and the numbers have to come OUT of the component
 * so it cannot pass while the scene says something else. Two numbers agreeing
 * by coincidence is exactly how this broke.
 */
const source = readFileSync(new URL("./Movable.tsx", import.meta.url), "utf8");

describe("the face you grab an unlocked panel by", () => {
  it("is built from the panel's size (PANEL unless said) rather than from numbers typed twice", () => {
    expect(source, "the grab face must take its size from the panel's").toMatch(/planeGeometry args=\{\[size\.width, size\.height\]\}/);
    expect(source, "a room panel's size is PANEL").toMatch(/size = PANEL,/);
  });

  it("is centred on the panel, not hung above it", () => {
    // `[0, 0, z]`: any y offset moves the grabbable area off the panel, and
    // whatever it uncovers stops being draggable without anything saying so.
    const face = source.match(/position=\{\[0, (-?[\d.]+), [\d.]+\]\}\s*\n\s*onPointerDown[\s\S]*?planeGeometry args=\{\[size\.width/);
    expect(face, "could not find the grab face's position").not.toBeNull();
    expect(Number(face![1]), "the grab face must be centred on the panel").toBe(0);
  });

  const barHeight = () => Number(source.match(/const BAR_HEIGHT = ([\d.]+);/)?.[1]);

  it("does not reach as high as the drag bar, which would steal its presses, at any panel's size", () => {
    // The face sits in FRONT of the bar, so any overlap is the face winning. The
    // top and the bar's height are read from the source and worked for a room
    // panel and for a screen-sized one (MyScreen).
    const topSource = source.match(/const top = size\.height \/ 2 \+ ([\d.]+);/)?.[1];
    const barSource = source.match(/const barHeight = Math\.min\(BAR_HEIGHT, Math\.max\(([\d.]+), size\.height \* ([\d.]+)\)\);/);
    expect(topSource).toBeDefined();
    expect(barSource).not.toBeNull();
    for (const height of [PANEL.height, 0.62]) {
      const top = height / 2 + Number(topSource);
      const bar = Math.min(barHeight(), Math.max(Number(barSource![1]), height * Number(barSource![2])));
      expect(height / 2, `the face's top edge overlaps the drag bar at ${height} m`).toBeLessThanOrEqual(top - bar / 2);
    }
  });

  it("is a bar you can actually hit from across the room", () => {
    /**
     * FOUND BY MISSING IT, twice, while verifying the drag. It was 14cm tall:
     * from five metres that is about 1.6 degrees, some seven pixels in a window
     * and about as much as a controller ray wobbles. Four metres wide and too
     * thin to take hold of — the same fault as the Go table's rim.
     */
    const atFiveMetres = (2 * Math.atan(barHeight() / 2 / 5) * 180) / Math.PI;
    expect(atFiveMetres, "the drag bar is a sliver from a normal reading distance").toBeGreaterThan(3);
  });

  it("uses the panel's size for the bar's width too, so they cannot drift apart", () => {
    expect(source).toMatch(/boxGeometry args=\{\[size\.width, barHeight,/);
  });
});
