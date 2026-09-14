import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
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

  test("Nikk wears Lydia, however the room spells them", () => {
    // The room says `nikk2`; the chat capitalises it. A case-sensitive map
    // would quietly hand one spelling the default body.
    for (const name of ["nikk2", "Nikk2"]) {
      expect(modelFor(name)).toBe("lydia");
    }
  });

  test("Baiwei wears Baldman, however the room spells them", () => {
    // Nikk: "change Baiwei's avatar to Baldman".
    for (const name of ["baiwei2", "Baiwei2", "baiwei"]) {
      expect(modelFor(name)).toBe("baldman");
    }
  });

  test("every body somebody wears is actually in public/avatars", () => {
    // A name with no file behind it fails in the headset as a missing body,
    // long after the commit that caused it.
    const names = ["Inkstone", "Plumbline", "Sill", "nikk2", "baiwei2", "somebody-new"].map(modelFor);
    for (const name of names) {
      expect(existsSync(new URL(`../../public/avatars/${name}.vrm`, import.meta.url)), name).toBe(true);
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
