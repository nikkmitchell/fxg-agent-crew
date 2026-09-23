import { describe, expect, it } from "vitest";
import { GO_PLAYERS, GO_SIZES, defaultGoItem, type GoRoomItem } from "../../shared/room-items.js";
import { goSettingCost, goSettingFor, goSettingRequest } from "./GoTableSettings.js";

const table = (over: Partial<GoRoomItem> = {}): GoRoomItem => ({ ...defaultGoItem("t"), ...over });

describe("what a press means", () => {
  it("steps the board up and down through the sizes there are", () => {
    expect(goSettingFor(table({ size: 9 }), "go:size:more")).toEqual({ kind: "size", size: 13 });
    expect(goSettingFor(table({ size: 9 }), "go:size:less")).toEqual({ kind: "size", size: 5 });
  });

  it("STOPS AT THE ENDS AND SAYS SO instead of doing nothing", () => {
    const biggest = GO_SIZES[GO_SIZES.length - 1];
    const smallest = GO_SIZES[0];
    expect(goSettingFor(table({ size: biggest }), "go:size:more")).toMatchObject({ kind: "refused" });
    expect(goSettingFor(table({ size: smallest }), "go:size:less")).toMatchObject({ kind: "refused" });
    // A press that silently does nothing reads as a broken button.
    expect((goSettingFor(table({ size: biggest }), "go:size:more") as { why: string }).why).toMatch(/biggest/);
  });

  it("seats one more and one fewer", () => {
    expect(goSettingFor(table({ colours: ["a", "b"] }), "go:players:more")).toEqual({ kind: "players", players: 3 });
    expect(goSettingFor(table({ colours: ["a", "b", "c"] }), "go:players:less")).toEqual({ kind: "players", players: 2 });
  });

  it("will not seat fewer than two or more colours than exist", () => {
    expect(goSettingFor(table({ colours: ["a", "b"] }), "go:players:less")).toMatchObject({ kind: "refused" });
    const full = Array.from({ length: GO_PLAYERS.max }, (_, i) => `c${i}`);
    expect(goSettingFor(table({ colours: full }), "go:players:more")).toMatchObject({ kind: "refused" });
  });

  it("goes round the board types, both ways, and never refuses or warns", () => {
    // Nikk: "can we allow for changing board types inside the settings".
    expect(goSettingFor(table({ surface: "bamboo" }), "go:surface:more")).toEqual({ kind: "surface", surface: "stone" });
    expect(goSettingFor(table({ surface: "stone" }), "go:surface:more")).toEqual({ kind: "surface", surface: "bamboo" });
    expect(goSettingFor(table({ surface: "bamboo" }), "go:surface:less")).toEqual({ kind: "surface", surface: "stone" });
    const midGame = table({ stones: [{ x: 1, y: 1, colour: 0 }] });
    expect(goSettingCost(midGame, goSettingFor(midGame, "go:surface:more")!)).toBeNull();
    expect(goSettingRequest(table({ surface: "bamboo" }), "go:surface:more")).toEqual({ surface: "stone" });
  });

  it("ignores a press on a heading, and on nothing at all", () => {
    expect(goSettingFor(table(), "go:nothing")).toBeNull();
    expect(goSettingFor(table(), "")).toBeNull();
  });
});

describe("saying what a press will cost", () => {
  it("warns that changing the size clears a board with stones on it", () => {
    const played = table({ stones: [{ x: 1, y: 1, colour: 0 }] });
    expect(goSettingCost(played, { kind: "size", size: 13 })).toMatch(/clears the board/);
    expect(goSettingCost(table(), { kind: "size", size: 13 })).toBeNull();
  });

  it("counts the stones a leaving player takes with them", () => {
    const four = table({
      colours: ["a", "b", "c", "d"],
      stones: [
        { x: 0, y: 0, colour: 0 },
        { x: 1, y: 0, colour: 2 },
        { x: 2, y: 0, colour: 3 },
      ],
    });
    expect(goSettingCost(four, { kind: "players", players: 2 })).toMatch(/takes 2 stones off/);
    expect(goSettingCost(four, { kind: "players", players: 3 })).toMatch(/takes 1 stone off/);
    // Adding a seat costs nothing.
    expect(goSettingCost(four, { kind: "players", players: 5 })).toBeNull();
  });

  it("says nothing about a seating that loses nobody's stones", () => {
    const four = table({ colours: ["a", "b", "c", "d"], stones: [{ x: 0, y: 0, colour: 0 }] });
    expect(goSettingCost(four, { kind: "players", players: 2 })).toBeNull();
  });
});

describe("what a press sends, and what its retry sends", () => {
  it("sends the change the press means", () => {
    expect(goSettingRequest(table({ size: 9 }), "go:size:more")).toEqual({ size: 13 });
    expect(goSettingRequest(table({ colours: ["a", "b"] }), "go:players:more")).toEqual({ players: 3 });
    expect(goSettingRequest(table(), "go:reset")).toEqual({ reset: true });
  });

  it("sends nothing for closing, or for a press against a limit", () => {
    expect(goSettingRequest(table(), "go:close")).toBeNull();
    expect(goSettingRequest(table({ colours: ["a", "b"] }), "go:players:less")).toBeNull();
  });

  it("RE-READS THE TABLE for a retry, so it does not undo somebody else's change", () => {
    // Pressed "one more player" against a table of 2; before it landed, somebody
    // else made it 4. The retry must ask for 5 — not resend 3 and undo them.
    const pressedAgainst = table({ colours: ["a", "b"] });
    const nowIs = table({ colours: ["a", "b", "c", "d"] });
    expect(goSettingRequest(pressedAgainst, "go:players:more")).toEqual({ players: 3 });
    expect(goSettingRequest(nowIs, "go:players:more")).toEqual({ players: 5 });
  });
});
