import { describe, expect, it } from "vitest";
import { clampScroll, dragScroll, scrollThumb, wheelScroll } from "./chat-scroll.js";

/** Nikk (4936): whole messages, scroll up through them, back to the newest on arrival. */
describe("scrolling the chat wall", () => {
  it("rests on the newest message and cannot go past either end", () => {
    expect(clampScroll(-50, 2000, 600)).toBe(0);
    expect(clampScroll(5000, 2000, 600)).toBe(1400);
    expect(clampScroll(300, 2000, 600)).toBe(300);
    // Everything fits: nowhere to scroll.
    expect(clampScroll(300, 400, 600)).toBe(0);
  });

  it("pulling the wall down reads further back; pushing it up comes back", () => {
    // Pulled down by a quarter of the panel: 150 pixels further back.
    expect(dragScroll(0, 0.6, 0.35, 600, 2000)).toBeCloseTo(150);
    expect(dragScroll(150, 0.35, 0.6, 600, 2000)).toBeCloseTo(0);
    // And never past the oldest.
    expect(dragScroll(1300, 0.9, 0.1, 600, 2000)).toBe(1400);
  });

  it("a wheel notch moves a third of the wall, the usual way round", () => {
    expect(wheelScroll(0, -100, 600, 2000)).toBe(200);
    expect(wheelScroll(200, 100, 600, 2000)).toBe(0);
  });

  it("shows a scroll bar only when there is more than fits, at the bottom when resting", () => {
    expect(scrollThumb(0, 400, 600)).toBeNull();
    const resting = scrollThumb(0, 2400, 600)!;
    expect(resting.length).toBeCloseTo(0.25);
    expect(resting.from + resting.length).toBeCloseTo(1);
    const oldest = scrollThumb(1800, 2400, 600)!;
    expect(oldest.from).toBeCloseTo(0);
  });
});
