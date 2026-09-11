import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./space-wire";

/**
 * What a client is allowed to say about its own body.
 *
 * Every field here ends up driving a matrix in somebody else's headset, so the
 * things worth testing are the ones that poison it: a degenerate quaternion, a
 * non-number where a coordinate should be, and the difference between "my hand
 * is here" and "I cannot see my hand".
 */

const goodPose = { p: { x: 1, y: 1.6, z: -2 }, q: { x: 0, y: 0, z: 0, w: 1 } };
const move = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "move", at: { x: 0, y: 0, z: 0 }, facing: 0, ...extra });

describe("poses on the wire", () => {
  it("accepts a move with a head and two hands", () => {
    const parsed = parseClientMessage(
      move({ head: goodPose, hands: { left: goodPose, right: goodPose } }),
    );
    expect(parsed?.type).toBe("move");
    if (parsed?.type !== "move") throw new Error("unreachable");
    expect(parsed.head).toEqual(goodPose);
    expect(parsed.hands?.left).toEqual(goodPose);
  });

  it("keeps a move that mentions no head at all", () => {
    // An older client, or a window with nothing to report. It must still walk.
    const parsed = parseClientMessage(move());
    expect(parsed?.type).toBe("move");
    if (parsed?.type !== "move") throw new Error("unreachable");
    expect(parsed.head).toBeUndefined();
    expect(parsed.hands).toBeUndefined();
  });

  it("distinguishes an untracked hand from an absent one", () => {
    // null means "I looked and there is no hand"; absent means "I cannot say".
    // The first should stop a hand being drawn; the second changes nothing.
    const parsed = parseClientMessage(move({ hands: { left: null, right: goodPose } }));
    if (parsed?.type !== "move") throw new Error("unreachable");
    expect(parsed.hands?.left).toBeNull();
    expect(parsed.hands?.right).toEqual(goodPose);
  });

  it("refuses a degenerate quaternion", () => {
    // All zeros is what a tracker reports before it has locked on. It is not a
    // rotation, and three turns it into NaN the moment it is used — which then
    // spreads into every matrix it touches.
    const parsed = parseClientMessage(
      move({ head: { p: goodPose.p, q: { x: 0, y: 0, z: 0, w: 0 } } }),
    );
    if (parsed?.type !== "move") throw new Error("unreachable");
    expect(parsed.head).toBeUndefined();
  });

  it("refuses a head whose position is not numbers", () => {
    for (const p of [{ x: "over there", y: 0, z: 0 }, { x: 1e999, y: 0, z: 0 }, null]) {
      const parsed = parseClientMessage(move({ head: { p, q: goodPose.q } }));
      if (parsed?.type !== "move") throw new Error("unreachable");
      expect(parsed.head, JSON.stringify(p)).toBeUndefined();
    }
  });

  it("keeps the position when only the head is malformed", () => {
    // A broken tracker must not stop somebody walking around.
    const parsed = parseClientMessage(
      JSON.stringify({ type: "move", at: { x: 2, y: 0, z: 3 }, facing: 1, head: "nonsense" }),
    );
    if (parsed?.type !== "move") throw new Error("unreachable");
    expect(parsed.at).toEqual({ x: 2, y: 0, z: 3 });
    expect(parsed.head).toBeUndefined();
  });
});
