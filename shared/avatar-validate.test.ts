import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodySlug, checkAvatar, DEFAULT_LIMITS, nameFromTitle, REQUIRED_BONES } from "./avatar-validate";

const file = (name: string) => new Uint8Array(readFileSync(new URL(`../public/avatars/${name}.vrm`, import.meta.url)));

/** Rebuild a GLB from its JSON, keeping the binary chunk, so a test can break exactly one thing. */
function withJson(original: Uint8Array, edit: (json: any) => void): Uint8Array {
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + jsonLength)));
  edit(json);
  let text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20);
  padded.set(text); text = padded;
  const rest = original.subarray(20 + jsonLength);
  const out = new Uint8Array(20 + text.length + rest.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, text.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.set(rest, 20 + text.length);
  return out;
}

describe("the bodies already shipped are acceptable", () => {
  it("accepts Mica (VRM 1) and says so", () => {
    const check = checkAvatar(file("mica"));
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.info.version).toBe(1);
    expect(check.info.title).toContain("Mica");
    expect(check.info.bones).toBeGreaterThanOrEqual(REQUIRED_BONES.length);
    expect(check.info.triangles).toBeGreaterThan(1000);
  });

  it("accepts Skein and Shiro (VRM 0) and reads the licence", () => {
    for (const name of ["skein", "shiro"]) {
      const check = checkAvatar(file(name));
      expect(check.errors, name).toEqual([]);
      expect(check.info.version, name).toBe(0);
      expect(check.info.licence, name).toBe("CC0");
    }
  });
});

describe("what it refuses, and why, in a sentence", () => {
  it("a file that is not a GLB", () => {
    const check = checkAvatar(new TextEncoder().encode("hello, this is not a model at all"));
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toMatch(/Not a GLB/);
  });

  it("a truncated file", () => {
    const mica = file("mica");
    const check = checkAvatar(mica.subarray(0, mica.length - 100));
    expect(check.errors[0]).toMatch(/truncated or has extra bytes/);
  });

  it("a plain GLB with no VRM metadata", () => {
    const plain = withJson(file("mica"), (json) => { delete json.extensions.VRMC_vrm; });
    const check = checkAvatar(plain);
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toMatch(/plain GLB/);
  });

  it("a missing humanoid bone, named", () => {
    const check = checkAvatar(withJson(file("mica"), (json) => { delete json.extensions.VRMC_vrm.humanoid.humanBones.leftFoot; }));
    expect(check.errors.join(" ")).toContain("leftFoot");
  });

  it("a body that fetches something from elsewhere", () => {
    const check = checkAvatar(withJson(file("mica"), (json) => { json.images = [{ uri: "https://example.com/skin.png" }]; }));
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toMatch(/outside address/);
  });

  it("a body whose licence is not 'everyone'", () => {
    const check = checkAvatar(withJson(file("mica"), (json) => { json.extensions.VRMC_vrm.meta.avatarPermission = "onlyAuthor"; }));
    expect(check.errors.join(" ")).toMatch(/must allow 'everyone'/);
    const old = checkAvatar(withJson(file("skein"), (json) => { json.extensions.VRM.meta.allowedUserName = "OnlyAuthor"; }));
    expect(old.errors.join(" ")).toMatch(/must be 'Everyone'/);
  });

  it("too big, and too many triangles", () => {
    const tiny = { maxBytes: 1000, maxTriangles: 10 };
    const check = checkAvatar(file("mica"), tiny);
    expect(check.errors.some((line) => /limit is/.test(line) && /MB/.test(line))).toBe(true);
    expect(check.errors.some((line) => /triangles; the limit is 10/.test(line))).toBe(true);
    expect(DEFAULT_LIMITS.maxBytes).toBeGreaterThan(file("skein").length);
  });
});

describe("bodySlug", () => {
  it("makes a safe short name, and refuses what leaves nothing", () => {
    expect(bodySlug("Sill, the Threshold Keeper!")).toBe("sill-the-threshold-keeper");
    expect(bodySlug("  Ünïcode Jösé ")).toBe("unicode-jose");
    expect(bodySlug("../../etc/passwd")).toBe("etc-passwd");
    expect(bodySlug("a")).toBeNull();
    expect(bodySlug("!!!")).toBeNull();
    expect(bodySlug("x".repeat(80))!.length).toBeLessThanOrEqual(32);
  });
});

describe("nameFromTitle", () => {
  it("takes the name before the description", () => {
    expect(nameFromTitle("Mica - quiet mineral companion")).toBe("Mica");
    expect(nameFromTitle("Skein \u2014 The Threadkeeper")).toBe("Skein");
    expect(nameFromTitle("Sill, a threshold keeper")).toBe("Sill");
    expect(nameFromTitle("Plain Name")).toBe("Plain Name");
    expect(nameFromTitle("!")).toBeNull();
  });
});
