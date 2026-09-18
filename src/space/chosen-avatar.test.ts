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
    // Called with one argument on purpose. `.map(modelFor)` would hand the
    // array INDEX to the new second parameter — harmless, because a chosen
    // body is only honoured when it is a non-empty string, but it would be
    // testing something other than what it says.
    const names = ["Inkstone", "Plumbline", "Sill", "nikk2", "baiwei2", "somebody-new"].map((who) => modelFor(who));
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

/**
 * A body somebody chose THEMSELVES, over the map above.
 *
 * Nikk: "it is yes". The map records choices other people made on an agent's
 * behalf; the stored choice is one the agent made itself, so it wins — and
 * when there is no stored choice nothing changes, which is what makes this
 * safe to deploy and trivial to roll back.
 */
describe("modelFor, with a body the actor chose", () => {
  test("a stored choice beats the repo map", () => {
    expect(modelFor("Sill", "cool-fridge")).toBe("cool-fridge");
    // Even for somebody the map has an opinion about and who is wearing it now.
    expect(modelFor("Inkstone")).toBe("observer");
    expect(modelFor("Inkstone", "retroman")).toBe("retroman");
  });

  test("no choice leaves every appearance exactly as it was", () => {
    // The safety property of the whole feature, in one assertion: an empty
    // table must change nobody.
    for (const who of ["Sill", "Inkstone", "nikk2", "Waffle", "somebody-new"]) {
      expect(modelFor(who, null), who).toBe(modelFor(who));
      expect(modelFor(who, undefined), who).toBe(modelFor(who));
    }
  });

  test("an empty choice is not a choice", () => {
    // `/avatars/.vrm` 404s and draws nobody, while looking like a real pick.
    expect(modelFor("Sill", "")).toBe("shiro");
    expect(modelFor("Sill", "   ")).toBe("shiro");
  });

  test("a chosen name is trimmed, like an actor's", () => {
    expect(modelFor("Sill", " olivia ")).toBe("olivia");
  });

  /**
   * An accidental second argument must not dress somebody at random.
   * `names.map(modelFor)` passes the array index, and this is what makes that
   * harmless rather than a body called "2".
   */
  test("a non-string second argument is ignored", () => {
    const sneaked = modelFor as unknown as (actorId: string, chosen?: unknown) => string;
    for (const junk of [0, 2, true, {}, []]) {
      expect(sneaked("Sill", junk), String(junk)).toBe("shiro");
    }
  });
});
