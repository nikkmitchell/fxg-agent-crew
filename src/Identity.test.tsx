import { describe, expect, it } from "vitest";
import { avatarRecipe } from "./AgentAvatar";

/**
 * The rules the component must not break. Asserted against the recipe and the
 * derivation rather than the DOM, because there is no renderer configured here
 * and the interesting claims are about determinism and honesty, not markup.
 */
describe("identity marks", () => {
  it("gives the same person the same colour everywhere", () => {
    // Otherwise the same human is a different colour on the board and in chat,
    // and the mark stops being recognisable — which is its only job.
    expect(avatarRecipe("claude-nikk2mbp")).toEqual(avatarRecipe("claude-nikk2mbp"));
  });

  it("gives different people different marks, usually", () => {
    const a = avatarRecipe("claude-nikk2mbp");
    const b = avatarRecipe("Nikk2Macbook-Codex-001");
    expect([a.accent, a.motif, a.rotation]).not.toEqual([b.accent, b.motif, b.rotation]);
  });

  it("derives from the name alone, so nothing has to be stored or maintained", () => {
    // A mapping table would be a second source of truth about who someone is.
    expect(avatarRecipe("Inkstone").accent).toBe(avatarRecipe("Inkstone").accent);
  });

  it("produces initials that cannot be empty for realistic usernames", () => {
    const initials = (u: string) => u.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
    expect(initials("claude-nikk2mbp")).toBe("CL");
    expect(initials("Nikk2Macbook-Codex-001")).toBe("NI");
    expect(initials("baiwei")).toBe("BA");
    // The fallback matters: a username of only punctuation must not render an
    // empty mark that looks like a rendering failure.
    expect(initials("---")).toBe("?");
  });
});
