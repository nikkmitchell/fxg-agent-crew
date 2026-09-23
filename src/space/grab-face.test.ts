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
  it("is built from PANEL rather than from numbers typed twice", () => {
    expect(source, "the grab face must take its size from PANEL").toMatch(
      /planeGeometry args=\{\[PANEL\.width, PANEL\.height\]\}/,
    );
  });

  it("is centred on the panel, not hung above it", () => {
    // `[0, 0, z]`: any y offset moves the grabbable area off the panel, and
    // whatever it uncovers stops being draggable without anything saying so.
    const face = source.match(/position=\{\[0, (-?[\d.]+), [\d.]+\]\}\s*\n\s*onPointerDown[\s\S]*?planeGeometry args=\{\[PANEL/);
    expect(face, "could not find the grab face's position").not.toBeNull();
    expect(Number(face![1]), "the grab face must be centred on the panel").toBe(0);
  });

  const barHeight = () => Number(source.match(/const BAR_HEIGHT = ([\d.]+);/)?.[1]);

  it("does not reach as high as the drag bar, which would steal its presses", () => {
    // The face sits in FRONT of the bar, so any overlap is the face winning.
    // Both numbers come from the source: this used to assume a 14cm bar
    // (`top - 0.07`), which would have gone quietly wrong the day the bar
    // changed — and it did change.
    const top = Number(source.match(/const top = ([\d.]+);/)?.[1]);
    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(barHeight())).toBe(true);
    const barBottom = top - barHeight() / 2;
    expect(PANEL.height / 2, "the face's top edge overlaps the drag bar").toBeLessThanOrEqual(barBottom);
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

  it("uses PANEL for the bar's width too, so they cannot drift apart", () => {
    expect(source).toMatch(/boxGeometry args=\{\[PANEL\.width, BAR_HEIGHT,/);
  });
});
