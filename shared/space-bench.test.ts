import { describe, expect, it } from "vitest";
import { catalogueOf, readPieces } from "./space-bench";

describe("code pieces and the catalogue", () => {
  it("takes a published .js module as a code piece, and refuses anything else", () => {
    const published = new Map([["pieces/marimba.js", 4000], ["notes.txt", 10]]);
    const read = readPieces(JSON.stringify({ pieces: [
      { id: "marimba", name: "Marimba", code: "pieces/marimba.js" },
      { id: "notes", code: "notes.txt" },
      { id: "gone", code: "pieces/gone.js" },
    ] }), published);
    expect(read.pieces).toEqual([{ id: "marimba", name: "Marimba", kind: "code", path: "pieces/marimba.js", spin: false }]);
    expect(read.problems).toHaveLength(2);
  });

  it("lists pieces at stable URLs other spaces can import", () => {
    expect(catalogueOf("xr.instruments", [{ id: "marimba", name: "Marimba", kind: "code", path: "pieces/marimba.js", spin: false }])).toEqual([
      { space: "xr.instruments", id: "marimba", name: "Marimba", kind: "code", url: "/s/xr.instruments/pieces/marimba.js" },
    ]);
  });
});

describe("declared game slots", () => {
  it("keeps explicit self and composed-child grants and refuses invalid declarations", () => {
    const read = readPieces(JSON.stringify({pieces: [
      {id:"chess",item:"game.js",games:{"":"chess"}},
      {id:"room",space:"game.js",games:{"left/board":"chess"}},
      {id:"hidden",item:"game.js",games:{"../other":"chess"}},
      {id:"unknown",item:"game.js",games:{"":"go-fish"}},
    ]}), new Map([["game.js",100]]));
    expect(read.pieces.map(p=>p.games)).toEqual([{"":"chess"},{"left/board":"chess"}]);
    expect(read.problems).toHaveLength(2);
  });
});
