import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { catalogueKeys, findCatalogue, knownToTheCatalogue } from "../space/catalogue.js";

/**
 * FINDING THE CATALOGUE AT BOTH DEPTHS, which is the failure findUiRoot exists
 * to prevent and which this had to copy. From source this module sits at
 * server/space/ with the file at public/avatars/; deployed it sits at
 * dist-server/server/space/ with the file at dist/avatars/ — three levels up
 * instead of two. A path that is right in one is silently wrong in the other,
 * and the symptom is a refusal message that is merely less helpful, so nothing
 * would ever fail loudly.
 */
const tree = (leaf: string, from: string) => {
  const root = mkdtempSync(resolve(tmpdir(), "catalogue-"));
  mkdirSync(resolve(root, leaf, ".."), { recursive: true });
  writeFileSync(
    resolve(root, leaf),
    JSON.stringify({ avatars: [{ name: "AbissalDude" }, { name: "CoolCandle" }, { name: "" }, { nope: 1 }] }),
  );
  const start = resolve(root, from);
  mkdirSync(start, { recursive: true });
  return { root, start };
};

describe("findCatalogue", () => {
  it("finds it from the compiled layout, three levels down", () => {
    const { root, start } = tree("dist/avatars/catalogue.json", "dist-server/server/space");
    expect(findCatalogue(start)).toBe(resolve(root, "dist/avatars/catalogue.json"));
  });

  it("finds it from the source layout, two levels down", () => {
    const { root, start } = tree("public/avatars/catalogue.json", "server/space");
    expect(findCatalogue(start)).toBe(resolve(root, "public/avatars/catalogue.json"));
  });

  it("returns null rather than throwing when there is no catalogue", () => {
    // A missing catalogue costs a better refusal message and nothing else. It
    // must never fail a request.
    expect(findCatalogue(mkdtempSync(resolve(tmpdir(), "bare-")))).toBeNull();
  });
});

describe("catalogueKeys", () => {
  it("keys every name the spelling-insensitive way, skipping junk entries", () => {
    const { root } = tree("dist/avatars/catalogue.json", "x");
    const keys = catalogueKeys(resolve(root, "dist/avatars/catalogue.json"));
    expect(keys.has("abissaldude")).toBe(true);
    expect(keys.has("coolcandle")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("is empty for a missing or unparseable file, not an exception", () => {
    expect(catalogueKeys(null).size).toBe(0);
    const root = mkdtempSync(resolve(tmpdir(), "broken-"));
    const path = resolve(root, "catalogue.json");
    writeFileSync(path, "{ not json");
    expect(catalogueKeys(path).size).toBe(0);
  });
});

describe("knownToTheCatalogue", () => {
  it("answers for real catalogue names and not for invented ones", () => {
    const { start } = tree("dist/avatars/catalogue.json", "dist-server/server/space");
    const known = knownToTheCatalogue(start);
    expect(known("abissaldude")).toBe(true);
    expect(known("notabody")).toBe(false);
  });

  it("finds the real catalogue shipped in this repo", () => {
    // The one that matters: 300 bodies, at the path the server actually runs
    // from. This is what was dead in production until it was wired through.
    const known = knownToTheCatalogue();
    expect(known("abissaldude")).toBe(true);
    expect(known("shiro")).toBe(true);
  });
});
