import { describe, expect, it } from "vitest";
import { airWeaveLinks } from "./air-weave";

describe("shared-breath Air Weave links", () => {
  it("waits for at least two distinct participants", () => {
    expect(airWeaveLinks([])).toEqual([]);
    expect(airWeaveLinks(["Sill"])).toEqual([]);
    expect(airWeaveLinks(["Sill", "Sill"])).toEqual([]);
  });

  it("gives two participants one undirected bridge", () => {
    expect(airWeaveLinks(["Sill", "Nightjar"])).toEqual([["Nightjar", "Sill"]]);
  });

  it("forms one stable ring without duplicate or self links", () => {
    const links = airWeaveLinks(["Sill", "Inkstone", "Nightjar", "Sill", "Nikk2"]);
    expect(links).toEqual([
      ["Inkstone", "Nightjar"],
      ["Nightjar", "Nikk2"],
      ["Nikk2", "Sill"],
      ["Sill", "Inkstone"],
    ]);
    expect(airWeaveLinks(["Nikk2", "Nightjar", "Sill", "Inkstone", "Sill"])).toEqual(links);
    expect(links.every(([from, to]) => from !== to)).toBe(true);
  });
});
