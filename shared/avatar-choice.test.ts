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

  it("refuses an unknown name and points at the list of every body", () => {
    // With a catalogue in hand every one of the 300 is choosable, so the
    // actionable pointer is the catalogue rather than the fifteen files that
    // happen to ship here.
    const refused = chooseBody("Rook", () => null);
    expect(refused).toMatchObject({ code: "NO_SUCH_BODY" });
    expect("error" in refused && refused.error).toContain("catalogue.json");
  });

  it("names the served bodies when it has no catalogue to check against", () => {
    // A third answer: this server cannot tell whether Rook is a body or a
    // typo, and must not claim either. What it CAN offer is the fifteen it
    // holds, which is the only actionable thing it knows.
    const blind = chooseBody("Rook");
    expect(blind).toMatchObject({ code: "NOT_SERVED_YET" });
    expect("error" in blind && blind.error).toContain("Shiro");
    expect("error" in blind && blind.error).toContain("cannot read the avatar catalogue");
  });

  it("refuses nothing-at-all without pretending it was a typo", () => {
    for (const nothing of [undefined, null, "", "   ", 7, {}]) {
      expect(chooseBody(nothing), String(nothing)).toMatchObject({ code: "NO_SUCH_BODY" });
    }
  });

  /**
   * A CATALOGUE BODY IS A REAL ANSWER NOW. It used to be NOT_SERVED_YET, and
   * the server fetches the file on first use instead — so all 300 are
   * wearable and only an invented name is refused.
   */
  it("accepts any of the 300 from the catalogue, and says nobody has looked", () => {
    const inCatalogue = (key: string) => (key === "abissaldude" ? { name: "AbissalDude" } : null);
    const chosen = chooseBody("abissal dude", inCatalogue);
    expect(chosen).toMatchObject({ slug: "abissaldude", catalogue: "AbissalDude" });
    // null rather than a guess: a name is a poor guide to a picture, and
    // pretending otherwise is the mistake this project keeps making.
    expect("looked" in chosen && chosen.looked).toBeNull();

    expect(chooseBody("NotAnAvatarAtAll", inCatalogue)).toMatchObject({ code: "NO_SUCH_BODY" });
  });

  it("prefers the file on hand over the catalogue entry of the same name", () => {
    // Shiro is both. Fetching a second copy of a file we already serve would
    // mean two URLs for one body and a headset downloading it twice.
    const chosen = chooseBody("Shiro", () => ({ name: "Shiro" }));
    expect(chosen).toMatchObject({ slug: "shiro" });
    expect("looked" in chosen && chosen.looked).toBeTruthy();
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
