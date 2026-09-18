import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BODIES_ON_HAND, bodiesOnHand, bodyKey, chooseBody } from "./avatar-choice";

describe("bodyKey", () => {
  it("agrees across the three spellings of the same body", () => {
    expect(bodyKey("CoolCandle")).toBe(bodyKey("cool-candle"));
    expect(bodyKey("cool candle")).toBe(bodyKey("CoolCandle"));
    expect(bodyKey("  Shiro  ")).toBe("shiro");
  });
});

describe("chooseBody", () => {
  it("takes the slug, the catalogue name, or a human's spelling of either", () => {
    for (const asked of ["cool-candle", "CoolCandle", "Cool Candle", "COOLCANDLE"]) {
      const chosen = chooseBody(asked);
      expect(chosen, asked).toMatchObject({ slug: "cool-candle" });
    }
  });

  it("refuses an unknown name and says what IS available", () => {
    const refused = chooseBody("Rook");
    expect(refused).toMatchObject({ code: "NO_SUCH_BODY" });
    // The point of the refusal is that it is actionable without a second round
    // trip: it must name real options, not just decline.
    expect("error" in refused && refused.error).toContain("Shiro");
    expect("error" in refused && refused.error).toContain("catalogue.json");
  });

  it("refuses nothing-at-all without pretending it was a typo", () => {
    for (const nothing of [undefined, null, "", "   ", 7, {}]) {
      expect(chooseBody(nothing), String(nothing)).toMatchObject({ code: "NO_SUCH_BODY" });
    }
  });

  /**
   * THE TWO REFUSALS MUST STAY DIFFERENT. A body that exists in the catalogue
   * but has no file here is our shortfall, and reporting it as "no such body"
   * sends somebody looking for a spelling mistake they did not make.
   */
  it("distinguishes a body we cannot serve yet from one that does not exist", () => {
    const inCatalogue = (key: string) => key === "abissaldude";
    const notYet = chooseBody("AbissalDude", inCatalogue);
    expect(notYet).toMatchObject({ code: "NOT_SERVED_YET" });
    expect("error" in notYet && notYet.error).toContain("not serve its file yet");

    expect(chooseBody("NotAnAvatarAtAll", inCatalogue)).toMatchObject({ code: "NO_SUCH_BODY" });
  });

  it("never resolves to a body whose file is not on hand", () => {
    const slugs = new Set(BODIES_ON_HAND.map((body) => body.slug));
    for (const body of bodiesOnHand()) expect(slugs.has(body.slug)).toBe(true);
  });
});

/**
 * THE MANIFEST AND THE DIRECTORY MUST NOT DRIFT, and this is the only thing
 * that can notice. A slug listed here with no file is a body that resolves to
 * a 404 and draws nobody; a file with no entry is a body nobody can choose.
 * Both failures are invisible in a browser until somebody picks the wrong one.
 */
describe("what is actually on disk", () => {
  const served = readdirSync(resolve(import.meta.dirname, "../public/avatars"))
    .filter((file) => file.endsWith(".vrm"))
    .map((file) => file.replace(/\.vrm$/, ""));

  it("offers exactly the bodies whose files are served", () => {
    expect([...BODIES_ON_HAND].map((body) => body.slug).sort()).toEqual([...served].sort());
  });

  it("has no duplicate slugs", () => {
    const slugs = BODIES_ON_HAND.map((body) => body.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps the two known-bad bodies choosable, with what looking found", () => {
    // Deliberate: the room reports, it does not filter. See BodyOnHand.looked.
    for (const slug of ["chill", "crowley"]) {
      const body = BODIES_ON_HAND.find((one) => one.slug === slug);
      expect(body?.looked ?? "").toMatch(/draws|thick/i);
      expect(chooseBody(slug)).toMatchObject({ slug });
    }
  });
});
