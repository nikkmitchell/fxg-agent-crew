import { describe, expect, it } from "vitest";
import { hasSeenGoGuide, rememberGoGuide, type GoGuideStorage } from "./go-guide";

function memoryStorage(): GoGuideStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("first-game Go guide", () => {
  it("shows for a player until they dismiss it, then remembers only that player", () => {
    const storage = memoryStorage();
    expect(hasSeenGoGuide("Inkstone", storage)).toBe(false);
    rememberGoGuide("Inkstone", storage);
    expect(hasSeenGoGuide("inkstone", storage)).toBe(true);
    expect(hasSeenGoGuide("Sill", storage)).toBe(false);
  });

  it("does not fail when there is no player id or storage", () => {
    expect(hasSeenGoGuide(null, null)).toBe(false);
    expect(() => rememberGoGuide(null, null)).not.toThrow();
  });

  it("keeps the guide available when browser storage is restricted", () => {
    const blocked: GoGuideStorage = {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
    };
    expect(hasSeenGoGuide("Inkstone", blocked)).toBe(false);
    expect(() => rememberGoGuide("Inkstone", blocked)).not.toThrow();
  });
});
