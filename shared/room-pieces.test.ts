import { describe, expect, it } from "vitest";
import { TOGGLEABLE, allShown, applyPieces } from "./room-pieces";

describe("toggling what the room shows", () => {
  it("hides and shows one piece", () => {
    const off = applyPieces(allShown(), { name: "Koi pond", shown: false }, "Nikk");
    expect("pieces" in off && off.pieces.hidden).toEqual(["Koi pond"]);
    const on = "pieces" in off ? applyPieces(off.pieces, { name: "Koi pond", shown: true }, "Nikk") : off;
    expect("pieces" in on && on.pieces.hidden).toEqual([]);
  });
  it("hides all and shows all", () => {
    const none = applyPieces(allShown(), { all: false }, "Nikk");
    expect("pieces" in none && none.pieces.hidden.length).toBe(TOGGLEABLE.length);
    const back = "pieces" in none ? applyPieces(none.pieces, { all: true }, "Nikk") : none;
    expect("pieces" in back && back.pieces.hidden).toEqual([]);
  });
  it("refuses a name that is not in the room, and never offers the orb", () => {
    expect("refused" in applyPieces(allShown(), { name: "Swimming pool", shown: false }, "x")).toBe(true);
    expect(TOGGLEABLE).not.toContain("Breathing orb");
  });
});
