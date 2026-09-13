import { describe, expect, test } from "vitest";
import { isStill } from "./still-mode";

const at = (search: string) => ({ location: { search } });

describe("isStill", () => {
  test("the renderer says so explicitly", () => {
    expect(isStill(at("?still=1"))).toBe(true);
    expect(isStill(at("?embed=1&project=saha-ing&still=1"))).toBe(true);
  });

  test("an ordinary page is not a photograph", () => {
    expect(isStill(at(""))).toBe(false);
    expect(isStill(at("?embed=1"))).toBe(false);
  });

  test("embed alone is NOT a still — the window's panels are live and clickable", () => {
    // Stripping the controls from those would remove function that works.
    expect(isStill(at("?embed=1&project=x"))).toBe(false);
  });

  test("anything other than 1 is not a still", () => {
    expect(isStill(at("?still=0"))).toBe(false);
    expect(isStill(at("?still=true"))).toBe(false);
  });

  test("a scope with no location does not throw", () => {
    expect(isStill({})).toBe(false);
  });
});
