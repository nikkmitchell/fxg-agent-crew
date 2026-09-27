import { describe, expect, it } from "vitest";
import { BOWLS, BOWL_NOTES, BOWL_REST_MS, bowlForNote, bowlIndex, bowlNote, bowlStrength, mayStrike, onBowlWall, rimSpeed, strengthFromSpeed } from "./bowl.js";

describe("the singing bowls", () => {
  it("rings only the bowls' own notes, and picks one when not asked", () => {
    expect(bowlNote(220)).toBe(220);
    expect(bowlNote(9999, () => 0)).toBe(BOWL_NOTES[0]);
    expect(bowlNote("loud", () => 0.99)).toBe(BOWL_NOTES[BOWL_NOTES.length - 1]);
    for (const bowl of BOWLS) expect(BOWL_NOTES).toContain(bowl.note);
  });

  it("names a bowl only by a whole number in range, and finds the nearest bowl to a note", () => {
    expect(bowlIndex(1)).toBe(1);
    expect(bowlIndex(3)).toBeNull();
    expect(bowlIndex(0.5)).toBeNull();
    expect(bowlIndex("0")).toBeNull();
    expect(bowlForNote(150)).toBe(0);
    expect(bowlForNote(300)).toBe(2);
  });

  it("keeps a strength inside what a bowl can do", () => {
    expect(bowlStrength(5)).toBe(1);
    expect(bowlStrength(-1)).toBe(0.1);
    expect(bowlStrength("hard")).toBe(0.6);
    expect(strengthFromSpeed(0)).toBe(0.15);
    expect(strengthFromSpeed(10)).toBe(1);
  });

  it("lets each person ring again only after a pause, and others at once", () => {
    const last = new Map([["nikk2", 1_000]]);
    expect(mayStrike(last, "Nikk2", 1_000 + BOWL_REST_MS - 1)).toBe(false);
    expect(mayStrike(last, "Nikk2", 1_000 + BOWL_REST_MS)).toBe(true);
    expect(mayStrike(last, "wilson", 1_001)).toBe(true);
  });

  it("sings only for a finger ON the rim and going ROUND it", () => {
    const bowl = BOWLS[0];
    const onRim = { x: bowl.radius, y: bowl.height, z: 0 };
    expect(rimSpeed(onRim, { x: 0, y: 0, z: 0.5 }, bowl)).toBeCloseTo(0.5);
    expect(rimSpeed(onRim, { x: 0.5, y: 0, z: 0 }, bowl)).toBeCloseTo(0);
    expect(rimSpeed({ ...onRim, y: bowl.height + 0.2 }, { x: 0, y: 0, z: 0.5 }, bowl)).toBe(0);
  });

  it("strikes on the bowl's wall, not in the air beside it", () => {
    const bowl = BOWLS[1];
    expect(onBowlWall({ x: bowl.radius, y: bowl.height / 2, z: 0 }, bowl)).toBe(true);
    expect(onBowlWall({ x: bowl.radius + 0.1, y: bowl.height / 2, z: 0 }, bowl)).toBe(false);
    expect(onBowlWall({ x: bowl.radius, y: bowl.height + 0.1, z: 0 }, bowl)).toBe(false);
  });
});
