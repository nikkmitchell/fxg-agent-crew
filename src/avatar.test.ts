import { describe, expect, it } from "vitest";
import { MOTIF_COUNT, avatarRecipe, contrastRatio, initialsOf, readableInk, relativeLuminance } from "./avatar";

const seeds = Array.from({ length: 600 }, (_, index) => `actor-${index}`);

describe("contrast maths", () => {
  it("matches the WCAG anchors", () => {
    // If these two are right the ratio function is right; every other assertion
    // in this file rests on them.
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("does not depend on the order of its arguments", () => {
    expect(contrastRatio("#3156d8", "#e6ddc9")).toBeCloseTo(contrastRatio("#e6ddc9", "#3156d8"), 10);
  });

  it("puts white above black in luminance", () => {
    expect(relativeLuminance("#ffffff")).toBeGreaterThan(relativeLuminance("#141517"));
  });
});

describe("the initials stay readable on whatever the hash picked", () => {
  it("clears 4.5:1 for every actor id, not just the ones a person looked at", () => {
    // A hash chooses the colours, so nobody ever eyeballs most combinations.
    // This is the assertion that makes the palette list safe to extend.
    for (const seed of seeds) {
      const recipe = avatarRecipe(seed);
      expect(contrastRatio(recipe.ink, recipe.paper), `ink on paper for ${seed}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("picks the ink by measurement rather than by pairing", () => {
    expect(readableInk("#ffffff")).toBe("#141517");
    expect(readableInk("#141517")).toBe("#ffffff");
  });
});

describe("the art is stable and distinct", () => {
  it("is identical for the same actor id", () => {
    expect(avatarRecipe("baiwei")).toEqual(avatarRecipe("baiwei"));
  });

  it("differs between actors", () => {
    expect(avatarRecipe("baiwei")).not.toEqual(avatarRecipe("wilson"));
  });

  it("actually uses the whole motif range instead of collapsing onto one", () => {
    // A recipe that always returned motif 0 would pass every test above while
    // making every avatar look the same.
    const seen = new Set(seeds.map((seed) => avatarRecipe(seed).motif));
    expect(seen.size).toBe(MOTIF_COUNT);
  });

  it("uses more than one palette", () => {
    expect(new Set(seeds.map((seed) => avatarRecipe(seed).paper)).size).toBeGreaterThan(1);
  });

  it("keeps the motif inside the tile", () => {
    for (const seed of seeds) {
      const recipe = avatarRecipe(seed);
      expect(recipe.scale).toBeLessThanOrEqual(1);
      expect(recipe.offset).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("initials", () => {
  it("takes one letter from each of the first two words", () => {
    expect(initialsOf("Nikk Mitchell")).toBe("NM");
    expect(initialsOf("claude-nikk2mbp")).toBe("CN");
  });

  it("takes two letters from a single word", () => {
    expect(initialsOf("Inkstone")).toBe("IN");
  });

  it("says ? rather than inventing initials for a name with no letters", () => {
    // The founding bug of this component was a rail that showed everyone the
    // same made-up initials. A guess here is that bug again.
    expect(initialsOf("!!!")).toBe("?");
    expect(initialsOf("")).toBe("?");
  });
});
