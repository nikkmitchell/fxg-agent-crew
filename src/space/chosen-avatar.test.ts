import { describe, expect, test } from "vitest";
import { modelFor } from "./vrm-model";

describe("modelFor", () => {
  test("Inkstone wears the one Inkstone chose", () => {
    expect(modelFor("Inkstone")).toBe("observer");
  });

  test("Plumbline wears Retroman, under either spelling of the same agent", () => {
    expect(modelFor("claude-nikk2mbp")).toBe("retroman");
    expect(modelFor("Plumbline")).toBe("retroman");
  });

  test("Sill wears Shiro, however the room spells it", () => {
    for (const name of ["sill", "Sill", " SILL "]) {
      expect(modelFor(name)).toBe("shiro");
    }
  });

  test("Nikk and Baiwei both wear Lydia, however the room spells them", () => {
    // The room says `nikk2` and `baiwei2`; the chat capitalises them. A
    // case-sensitive map would quietly hand one spelling the default body.
    for (const name of ["nikk2", "Nikk2", "baiwei2", "Baiwei2"]) {
      expect(modelFor(name)).toBe("lydia");
    }
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
    expect(modelFor("somebody-new")).toBe("alienteen");
    expect(modelFor("")).toBe("alienteen");
  });
});
