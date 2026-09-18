import { describe, expect, it } from "vitest";
import { STILL_AFTER_MS, Stillness, hiddenAsStill, isStill } from "./stillness";
import type { WirePerson } from "./space-wire";

/**
 * Nikk: "an option to hide avatars that have not moved in more than 5 minutes
 * (though don't hide them automatically)". These pin down what "moved" means,
 * because every choice in it decides who disappears from somebody's room.
 */
const person = (actorId: string, change: Partial<WirePerson> = {}): WirePerson => ({
  actorId,
  kind: "agent",
  at: { x: 1, y: 0, z: 2 },
  moving: false,
  facing: 0.5,
  because: null,
  connected: false,
  head: null,
  hands: { left: null, right: null },
  attending: null,
  avatar: { mood: "focused", gesture: null, gestureStartedAt: null, gestureHoldMs: null, posture: "thinking" },
  ...change,
});

const MINUTE = 60_000;

describe("how long somebody has been still", () => {
  it("counts from the first time it saw them, because before that it cannot say", () => {
    const still = new Stillness();
    expect(still.observe([person("Corvid")], 0).get("Corvid")).toBe(0);
    expect(still.observe([person("Corvid")], 6 * MINUTE).get("Corvid")).toBe(6 * MINUTE);
  });

  it("starts again when they walk, turn, move a head or a hand, or gesture", () => {
    const moves: [string, Partial<WirePerson>][] = [
      ["walked", { at: { x: 1.5, y: 0, z: 2 } }],
      ["turned", { facing: 1.2 }],
      ["moved their head", { head: { p: { x: 1, y: 1.6, z: 2 }, q: { x: 0, y: 0, z: 0, w: 1 } } }],
      ["moved a hand", { hands: { left: { p: { x: 0.8, y: 1, z: 2 }, q: { x: 0, y: 0, z: 0, w: 1 } }, right: null } }],
      ["waved", { avatar: { mood: "focused", gesture: "wave", gestureStartedAt: 1, gestureHoldMs: null, posture: "thinking" } }],
      ["is being walked somewhere", { moving: true }],
    ];
    for (const [what, change] of moves) {
      const still = new Stillness();
      still.observe([person("Corvid")], 0);
      expect(still.observe([person("Corvid", change)], 6 * MINUTE).get("Corvid"), what).toBe(0);
    }
  });

  it("counts the same gesture made again as moving, because it starts again", () => {
    const wave = (at: number) =>
      person("Corvid", { avatar: { mood: "focused", gesture: "wave", gestureStartedAt: at, gestureHoldMs: null, posture: "thinking" } });
    const still = new Stillness();
    still.observe([wave(100)], 0);
    expect(still.observe([wave(100)], 2 * MINUTE).get("Corvid")).toBe(2 * MINUTE);
    expect(still.observe([wave(200_000)], 3 * MINUTE).get("Corvid")).toBe(0);
  });

  /**
   * The room lies an idle agent down by itself after five minutes of doing
   * nothing. Counting that as movement would keep exactly the figures this
   * setting exists to hide on screen for another five minutes.
   */
  it("does not count falling asleep, or a change of mood, as moving", () => {
    const still = new Stillness();
    still.observe([person("Vint")], 0);
    const asleep = person("Vint", {
      avatar: { mood: "neutral", gesture: null, gestureStartedAt: null, gestureHoldMs: null, posture: "sleeping" },
    });
    expect(still.observe([asleep], 6 * MINUTE).get("Vint")).toBe(6 * MINUTE);
  });

  it("does not count a position that differs only past the last visible digit", () => {
    const still = new Stillness();
    still.observe([person("anita", { at: { x: 1.0000001, y: 0, z: 2 } })], 0);
    expect(still.observe([person("anita", { at: { x: 1.0000004, y: 0, z: 2 } })], 6 * MINUTE).get("anita")).toBe(6 * MINUTE);
  });

  it("forgets somebody who leaves, so coming back counts as arriving", () => {
    const still = new Stillness();
    still.observe([person("clem"), person("Corvid")], 0);
    still.observe([person("Corvid")], MINUTE);
    expect(still.observe([person("clem"), person("Corvid")], 6 * MINUTE).get("clem")).toBe(0);
  });

  it("keeps counting when the room re-spells somebody's name", () => {
    // Presence renames an occupant when a live session spells them differently
    // from the audit row that placed them. That is the same person standing in
    // the same place, not somebody leaving and somebody else arriving.
    const still = new Stillness();
    still.observe([person("nikk2")], 0);
    const later = still.observe([person("Nikk2")], 6 * MINUTE);
    expect(later.get("Nikk2")).toBe(6 * MINUTE);
  });

  it("keeps each person's count separate", () => {
    const still = new Stillness();
    still.observe([person("Corvid"), person("clem")], 0);
    const later = still.observe([person("Corvid"), person("clem", { facing: 2 })], 6 * MINUTE);
    expect(later.get("Corvid")).toBe(6 * MINUTE);
    expect(later.get("clem")).toBe(0);
  });
});

describe("who the setting hides", () => {
  it("hides from five minutes, not before", () => {
    expect(isStill({ stillForMs: STILL_AFTER_MS - 1 })).toBe(false);
    expect(isStill({ stillForMs: STILL_AFTER_MS })).toBe(true);
  });

  it("never hides somebody because a number is missing", () => {
    // A server older than this sends no stillForMs. Not measured is not still.
    expect(isStill({})).toBe(false);
    expect(hiddenAsStill([{ actorId: "Corvid" }], "Nikk2")).toEqual([]);
  });

  it("never hides you, however the room spells your name", () => {
    const people = [
      { actorId: "Nikk2", stillForMs: 10 * MINUTE },
      { actorId: "Corvid", stillForMs: 10 * MINUTE },
      { actorId: "clem", stillForMs: MINUTE },
    ];
    expect(hiddenAsStill(people, "nikk2")).toEqual(["Corvid"]);
    expect(hiddenAsStill(people, null)).toEqual(["Nikk2", "Corvid"]);
  });
});
