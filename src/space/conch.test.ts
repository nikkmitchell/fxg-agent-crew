import { describe, expect, it } from "vitest";
import { conchLevel } from "./Conch";

describe("the conch", () => {
  it("is silent until your head is close, and loudest at the lip", () => {
    expect(conchLevel(1)).toBe(0);
    expect(conchLevel(0.35)).toBe(0);
    expect(conchLevel(0.2)).toBeGreaterThan(0);
    expect(conchLevel(0)).toBe(1);
  });
});
