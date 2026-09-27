import { describe, expect, it } from "vitest";
import { OFFERING_LONGEST, READY_WORDS, cleanOffering, sparkAt } from "./fire.js";

describe("the ember fire", () => {
  it("takes one trimmed line, not too long, and nothing empty", () => {
    expect(cleanOffering("  my   old\nworry ")).toBe("my old worry");
    expect(cleanOffering("x".repeat(99))).toHaveLength(OFFERING_LONGEST);
    expect(cleanOffering("   ")).toBeNull();
    expect(cleanOffering(7)).toBeNull();
    for (const word of READY_WORDS) expect(cleanOffering(word)).toBe(word);
  });

  it("sends each spark up and away, and lets it cool to nothing", () => {
    const early = sparkAt(0.3, 0.2);
    const later = sparkAt(0.3, 1.5);
    expect(later.y).toBeGreaterThan(early.y);
    expect(later.glow).toBeLessThan(early.glow);
    expect(sparkAt(0.3, 10).glow).toBe(0);
  });
});
