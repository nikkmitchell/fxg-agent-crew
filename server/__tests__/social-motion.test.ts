import { describe, expect, it } from "vitest";
import { ROOM, deskFor } from "../../shared/space-layout.js";
import {
  AMBIENT_PAUSE_MIN_MS,
  CONVERSATION_DISTANCE,
  ambientPauseMs,
  ambientPlace,
  conversationPlace,
} from "../space/social-motion.js";

const gap = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("social motion planning", () => {
  it("puts a speaker at comfortable conversational distance", () => {
    const listener = { x: 2, y: 0, z: -2 };
    const place = conversationPlace({ x: -5, y: 0, z: 4 }, listener, "Inkstone");
    expect(gap(place, listener)).toBeCloseTo(CONVERSATION_DISTANCE, 6);
    expect(gap(place, { x: -5, z: 4 })).toBeLessThan(gap(listener, { x: -5, z: 4 }));
  });

  it("keeps the conversation circle inside the room beside a wall", () => {
    const place = conversationPlace(
      { x: ROOM.width / 2 - 0.5, y: 0, z: 0 },
      { x: ROOM.width / 2 - 0.5, y: 0, z: 0 },
      "Sill",
    );
    expect(Math.abs(place.x)).toBeLessThan(ROOM.width / 2);
    expect(Math.abs(place.z)).toBeLessThan(ROOM.depth / 2);
  });

  it("gives idle agents bounded, changing waypoints near their desk", () => {
    const home = deskFor("Plumbline");
    const first = ambientPlace("Plumbline", 0);
    const second = ambientPlace("Plumbline", 1);
    expect(first).not.toEqual(second);
    expect(gap(first, home)).toBeLessThan(3);
    expect(Math.abs(first.x)).toBeLessThan(ROOM.width / 2);
    expect(Math.abs(first.z)).toBeLessThan(ROOM.depth / 2);
  });

  it("varies pauses without ever turning wandering into pacing", () => {
    const pauses = [0, 1, 2, 3].map((sequence) => ambientPauseMs("Inkstone", sequence));
    expect(new Set(pauses).size).toBeGreaterThan(1);
    expect(Math.min(...pauses)).toBeGreaterThanOrEqual(AMBIENT_PAUSE_MIN_MS);
  });
});
