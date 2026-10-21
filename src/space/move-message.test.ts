import { describe, expect, it } from "vitest";
import { moveMessage } from "./useSpaceSocket";

describe("a move, as the room's socket carries it", () => {
  it("rounds to four decimals and keeps what was sent, headset or not", () => {
    const pose = { p: { x: 0.123456789, y: 1.6000001, z: -2.987654321 }, q: { x: 0.1, y: 0.2, z: 0.3, w: 0.9271838546 } };
    const message = moveMessage({ x: 1.23456789, y: 0, z: -3.3333333 }, 0.987654321,
      { head: pose, hands: { left: { ...pose, f: Array(20).fill(0.25) }, right: null } }, 1.62);
    expect(message).toMatchObject({
      type: "move", at: { x: 1.2346, y: 0, z: -3.3333 }, facing: 0.9877, standing: 1.62,
      head: { p: { x: 0.1235, y: 1.6, z: -2.9877 }, q: { w: 0.9272 } },
      hands: { left: { f: Array(20).fill(0.25) }, right: null },
    });
  });

  it("leaves out what a flat screen does not have", () => {
    const message = moveMessage({ x: 1, y: 0, z: 2 }, 0.5);
    expect(message).toEqual({ type: "move", at: { x: 1, y: 0, z: 2 }, facing: 0.5 });
  });
});
