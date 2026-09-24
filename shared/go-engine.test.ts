import { describe, expect, it } from "vitest";
import { applyGoMove, positionKey, scoreGoArea, suggestGoMove } from "./go-engine.js";
import { defaultGoItem, type GoRoomItem } from "./room-items.js";

const empty = (): GoRoomItem => defaultGoItem("table");

describe("bounded Go rules", () => {
  it("counts surrounded empty points as area and applies two-color white komi", () => {
    const item: GoRoomItem = { ...empty(), size: 5, stones: [{ x: 0, y: 0, colour: 0 }] };
    expect(scoreGoArea(item)).toEqual({ area: [25, 0], komi: [0, 6.5], totals: [25, 6.5], winner: 0 });
  });

  it("captures an adjacent group when its last liberty is filled", () => {
    const item = { ...empty(), stones: [
      { x: 1, y: 1, colour: 1 },
      { x: 0, y: 1, colour: 0 }, { x: 2, y: 1, colour: 0 }, { x: 1, y: 0, colour: 0 },
    ] };
    const result = applyGoMove(item, 0, { x: 1, y: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.captured).toBe(1);
      expect(result.stones.some((stone) => stone.x === 1 && stone.y === 1)).toBe(false);
    }
  });

  it("rejects suicide without changing the position", () => {
    const item = { ...empty(), stones: [
      { x: 0, y: 1, colour: 1 }, { x: 2, y: 1, colour: 1 },
      { x: 1, y: 0, colour: 1 }, { x: 1, y: 2, colour: 1 },
    ] };
    expect(applyGoMove(item, 0, { x: 1, y: 1 })).toEqual({ ok: false, reason: "suicide" });
    expect(item.stones).toHaveLength(4);
  });

  it("rejects immediate ko recapture but allows it after a pass clears ko", () => {
    const start: GoRoomItem = { ...empty(), stones: [
      { x: 2, y: 2, colour: 1 },
      { x: 1, y: 2, colour: 0 }, { x: 2, y: 1, colour: 0 }, { x: 3, y: 2, colour: 0 },
      { x: 1, y: 3, colour: 1 }, { x: 3, y: 3, colour: 1 }, { x: 2, y: 4, colour: 1 },
    ] };
    const original = positionKey(start.size, start.stones);
    const capture = applyGoMove(start, 0, { x: 2, y: 3 });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const afterCapture: GoRoomItem = { ...start, stones: capture.stones, previousPosition: capture.previousPosition };
    expect(applyGoMove(afterCapture, 1, { x: 2, y: 2 })).toEqual({ ok: false, reason: "ko" });
    expect(original).toBe(capture.previousPosition);
    expect(applyGoMove({ ...afterCapture, previousPosition: null }, 1, { x: 2, y: 2 }).ok).toBe(true);
  });
});

describe("a player's own low-cost Go card", () => {
  it("lets patient and experimental play choose different legal openings", () => {
    const item = empty();
    const patient = suggestGoMove(item, 0, { style: "patient", risk: "balanced", signature: "" }, "one");
    const experimental = suggestGoMove(item, 0, { style: "experimental", risk: "bold", signature: "" }, "two");
    expect(patient).not.toBeNull();
    expect(experimental).not.toBeNull();
    expect([patient?.x, patient?.y]).not.toEqual([experimental?.x, experimental?.y]);
  });

  it("lets a tactical card value a capture more than a patient card does", () => {
    const item: GoRoomItem = { ...empty(), stones: [
      { x: 1, y: 1, colour: 1 },
      { x: 0, y: 1, colour: 0 }, { x: 2, y: 1, colour: 0 }, { x: 1, y: 0, colour: 0 },
    ] };
    const tactical = suggestGoMove(item, 0, { style: "tactical", risk: "bold", signature: "" }, "hunter");
    const patient = suggestGoMove(item, 0, { style: "patient", risk: "cautious", signature: "" }, "gardener");
    expect(tactical).toMatchObject({ x: 1, y: 2 });
    expect(patient).not.toMatchObject({ x: 1, y: 2 });
  });

  it("does not make a move for an observer or after the game ends", () => {
    const item = empty();
    expect(suggestGoMove(item, 0, { style: "observer", risk: "balanced", signature: "" }, "watcher")).toBeNull();
    expect(suggestGoMove({ ...item, gameOver: true }, 0, { style: "patient", risk: "balanced", signature: "" }, "player")).toBeNull();
  });
});
