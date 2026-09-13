import { describe, expect, test } from "vitest";
import { modelFor } from "./vrm-model";

describe("modelFor", () => {
  test("Inkstone wears the one Inkstone chose", () => {
    expect(modelFor("Inkstone")).toBe("observer");
  });

  test("Plumbline wears Chill, under either spelling of the same agent", () => {
    expect(modelFor("claude-nikk2mbp")).toBe("chill");
    expect(modelFor("Plumbline")).toBe("chill");
  });

  test("the room spells people differently from the chat, and it still matches", () => {
    // `inkstone` in the room, `Inkstone` in WebHarness. A case-sensitive map
    // would hand one of them the default body with no sign anything was wrong.
    expect(modelFor("inkstone")).toBe(modelFor("INKSTONE"));
  });

  test("stray whitespace does not lose somebody their avatar", () => {
    expect(modelFor(" Inkstone ")).toBe("observer");
  });

  test("anybody who has not chosen gets the default, not nothing", () => {
    expect(modelFor("nikk2")).toBe("alienteen");
    expect(modelFor("")).toBe("alienteen");
  });
});
