import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { catalogueBodies, catalogueKeys, findCatalogue, knownToTheCatalogue } from "../space/catalogue.js";

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
    JSON.stringify({
      avatars: [
        { name: "AbissalDude", model: "https://arweave.net/abc" },
        { name: "CoolCandle", model: "https://arweave.net/def" },
        // Each of these must be dropped: no name, no model, or a model this
        // server must never fetch from.
        { name: "", model: "https://arweave.net/ghi" },
        { name: "NoModel" },
        { name: "Local", model: "file:///etc/passwd" },
        { nope: 1 },
      ],
    }),
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

  it("drops an entry with no model, and any address that is not https", () => {
    // A body with no fetchable file is not a body anybody can choose, and a
    // file:// address in the catalogue must not be reachable from a request.
    const { root } = tree("dist/avatars/catalogue.json", "x");
    const bodies = catalogueBodies(resolve(root, "dist/avatars/catalogue.json"));
    expect(bodies.has("nomodel")).toBe(false);
    expect(bodies.has("local")).toBe(false);
    expect(bodies.get("abissaldude")).toEqual({ name: "AbissalDude", model: "https://arweave.net/abc" });
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
    expect(known("abissaldude")).toEqual({ name: "AbissalDude", model: "https://arweave.net/abc" });
    expect(known("notabody")).toBeNull();
  });

  it("finds the real catalogue shipped in this repo", () => {
    // The one that matters: 300 bodies, at the path the server actually runs
    // from. This is what was dead in production until it was wired through.
    const known = knownToTheCatalogue();
    // The model URL is what makes the fetch possible AND safe: it comes from
    // this file and never from a caller.
    expect(known("abissaldude")?.model).toMatch(/^https:\/\//);
    expect(known("shiro")?.name).toBe("Shiro");
  });
});
