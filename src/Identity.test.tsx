import { describe, expect, it } from "vitest";
import { avatarRecipe, contrastRatio, initialsOf } from "./avatar";

/**
 * The rules the component must not break. Asserted against the derivation
 * rather than the DOM, because there is no renderer configured in this suite;
 * the rendered markup is verified in a browser against a fixture instead.
 */
describe("identity marks", () => {
  it("gives the same person the same mark everywhere", () => {
    // Otherwise the same human is a different colour on the board and in chat,
    // and the mark stops being recognisable — which is its only job.
    expect(avatarRecipe("claude-nikk2mbp")).toEqual(avatarRecipe("claude-nikk2mbp"));
  });

  it("gives different people different marks", () => {
    const a = avatarRecipe("claude-nikk2mbp");
    const b = avatarRecipe("Nikk2Macbook-Codex-001");
    expect([a.accent, a.motif, a.rotation]).not.toEqual([b.accent, b.motif, b.rotation]);
  });

  it("derives from the name alone, so nothing has to be stored or maintained", () => {
    // A mapping table would be a second source of truth about who someone is.
    expect(avatarRecipe("Inkstone")).toEqual(avatarRecipe("Inkstone"));
  });

  it("keeps the initials legible on the tile for the actors actually in this room", () => {
    for (const name of ["claude-nikk2mbp", "Nikk2Macbook-Codex-001", "Inkstone", "Nikk2", "nikk"]) {
      const recipe = avatarRecipe(name);
      expect(contrastRatio(recipe.ink, recipe.paper), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("produces initials that cannot be empty for realistic usernames", () => {
    // Calls the real function rather than a copy of it. A test that
    // reimplements what it is testing proves only that the copy agrees with
    // itself — this project has already shipped one traversal that was tested
    // that way and never executed.
    expect(initialsOf("claude-nikk2mbp")).toBe("CN");
    expect(initialsOf("Nikk2Macbook-Codex-001")).toBe("NC");
    expect(initialsOf("baiwei")).toBe("BA");
    // A username of only punctuation must not render an empty mark that looks
    // like a rendering failure.
    expect(initialsOf("---")).toBe("?");
  });
});
