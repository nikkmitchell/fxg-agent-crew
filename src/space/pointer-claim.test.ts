import { describe, expect, it } from "vitest";
import { claimPointer, pointerWasClaimed } from "./pointer-claim.js";

/**
 * Plain objects stand in for PointerEvents: the WeakSet does not care what kind
 * of object it holds, and the thing worth testing is that a mark belongs to one
 * event and not to the next one.
 */
const anEvent = () => ({ type: "pointerdown" });

describe("claiming a pointer", () => {
  it("remembers the event a panel took", () => {
    const event = anEvent();
    claimPointer(event);
    expect(pointerWasClaimed(event)).toBe(true);
  });

  it("says nothing about an event nobody took", () => {
    expect(pointerWasClaimed(anEvent())).toBe(false);
  });

  it("DOES NOT LEAK TO THE NEXT PRESS", () => {
    // The whole reason this is a mark on an event rather than a flag in a
    // module. A claim that outlived its event would lock the camera: press a
    // card once and drag-to-look never works again.
    const first = anEvent();
    claimPointer(first);
    const second = anEvent();
    expect(pointerWasClaimed(second)).toBe(false);
  });

  it("survives being claimed twice", () => {
    // Two meshes under one ray both stopping propagation is normal, not a bug.
    const event = anEvent();
    claimPointer(event);
    claimPointer(event);
    expect(pointerWasClaimed(event)).toBe(true);
  });

  it("does not throw when there is no native event", () => {
    // R3F synthetic events carry one, but a test double or a future version
    // might not, and a missing event must mean "not claimed" rather than a
    // crash that takes the whole room down.
    expect(() => claimPointer(null)).not.toThrow();
    expect(pointerWasClaimed(undefined)).toBe(false);
  });
});
