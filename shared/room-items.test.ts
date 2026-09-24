import { describe, expect, it } from "vitest";
import { defaultGoItem, parseRoomItem } from "./room-items.js";

describe("room-item state upgrades", () => {
  it("fills the new Go state defaults when reading a table created by an older build", () => {
    const item = defaultGoItem("old");
    const { seats: _seats, previousPosition: _previousPosition, moveNumber: _moveNumber,
      consecutivePasses: _consecutivePasses, gameOver: _gameOver, mode: _mode, turnActor: _turnActor,
      score: _score, ...oldState } = item;
    oldState.stones = [{ x: 2, y: 3, colour: 0 }];
    expect(parseRoomItem(oldState)).toMatchObject({
      seats: [null, null], previousPosition: null, moveNumber: 1,
      consecutivePasses: 0, gameOver: false, mode: "seated", turnActor: null, score: null,
    });
  });

  it("rejects duplicate color ownership, case-insensitively", () => {
    expect(parseRoomItem({ ...defaultGoItem("bad"), seats: ["Inkstone", "inkstone"] })).toBeNull();
  });

  it("rejects corrupted repeated points instead of letting the engine guess", () => {
    const item = defaultGoItem("bad-stones");
    const point = { x: 2, y: 2, colour: 0 };
    expect(parseRoomItem({ ...item, stones: [point, point] })).toBeNull();
  });
});
