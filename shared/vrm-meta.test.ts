import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DRIVEN_BONES, readVrmMeta, whyNotUsable, type VrmMeta } from "./vrm-meta";

/** A .glb with the JSON chunk we want and no binary chunk, which is enough. */
const glb = (json: unknown, { magic = 0x46546c67 } = {}): Uint8Array => {
  const body = new TextEncoder().encode(JSON.stringify(json));
  // The JSON chunk must be 4-byte aligned in a real glb; pad with spaces, as
  // exporters do, so the parse still works.
  const padded = new Uint8Array(Math.ceil(body.length / 4) * 4).fill(0x20);
  padded.set(body);
  const out = new Uint8Array(20 + padded.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(padded, 20);
  return out;
};

const fullRig = DRIVEN_BONES.map((bone) => ({ bone }));
const good = {
  extensions: {
    VRM: {
      meta: {
        title: "Shiro",
        author: "Polygonal Mind",
        licenseName: "CC0",
        allowedUserName: "Everyone",
        commercialUssageName: "Allow",
      },
      humanoid: { humanBones: fullRig },
    },
  },
};

describe("readVrmMeta", () => {
  it("reads what the author asserted", () => {
    const meta = readVrmMeta(glb(good)) as VrmMeta;
    expect(meta).toMatchObject({
      title: "Shiro",
      author: "Polygonal Mind",
      licence: "CC0",
      allowedUsers: "Everyone",
      commercialUse: "Allow",
      missingBones: [],
    });
    expect(meta.bones).toBe(DRIVEN_BONES.length);
  });

  it("accepts either spelling of the misspelled commercial-use key", () => {
    // The 0.x exporter wrote `commercialUssageName`, with the typo. Files
    // exist with both, and reading only one silently loses the answer.
    const fixed = { extensions: { VRM: { meta: { commercialUsageName: "Allow" }, humanoid: { humanBones: fullRig } } } };
    expect((readVrmMeta(glb(fixed)) as VrmMeta).commercialUse).toBe("Allow");
  });

  it("names every missing driven bone rather than just failing", () => {
    const short = {
      extensions: { VRM: { meta: {}, humanoid: { humanBones: [{ bone: "hips" }, { bone: "head" }] } } },
    };
    const meta = readVrmMeta(glb(short)) as VrmMeta;
    expect(meta.missingBones).toContain("leftHand");
    expect(meta.missingBones).not.toContain("hips");
  });

  it("says which kind of not-a-VRM it is", () => {
    expect(readVrmMeta(glb({ extensions: {} }))).toEqual({ error: "no VRM 0.x extension" });
    // A format gap, not a corrupt file — the next person needs to know which.
    expect(readVrmMeta(glb({ extensions: { VRMC_vrm: {} } }))).toMatchObject({
      error: expect.stringContaining("VRM 1.0"),
    });
    expect(readVrmMeta(glb(good, { magic: 0x11111111 }))).toEqual({ error: "not a glb" });
    expect(readVrmMeta(new Uint8Array(4))).toEqual({ error: "too short to be a glb" });
  });

  it("reports a truncated read as truncated, not as a bad file", () => {
    // What happens when only the head of a stream was read and the JSON chunk
    // is longer than that. Confusing the two would send somebody hunting for a
    // corrupt avatar that is fine.
    const whole = glb(good);
    const result = readVrmMeta(whole.subarray(0, 40));
    expect(result).toMatchObject({ error: expect.stringContaining("only 40 were read") });
  });

  it("does not throw on a json chunk that is not json", () => {
    const broken = glb(good);
    broken.set(new TextEncoder().encode("{ nope"), 20);
    expect(readVrmMeta(broken)).toEqual({ error: "the glb's json chunk does not parse" });
  });
});

describe("whyNotUsable", () => {
  const base = readVrmMeta(glb(good)) as VrmMeta;

  it("passes a CC0 Everyone file with a full rig", () => {
    expect(whyNotUsable(base)).toBeNull();
  });

  it("refuses a licence that is not CC0, and says what it found", () => {
    expect(whyNotUsable({ ...base, licence: "CC_BY" })).toContain("CC_BY");
    expect(whyNotUsable({ ...base, licence: null })).toContain("absent");
  });

  it("refuses a body its author did not release to everyone", () => {
    expect(whyNotUsable({ ...base, allowedUsers: "OnlyAuthor" })).toContain("OnlyAuthor");
  });

  it("refuses a rig that would throw while being posed, naming the bones", () => {
    expect(whyNotUsable({ ...base, missingBones: ["leftHand", "neck"] })).toContain("leftHand, neck");
  });
});

/**
 * THE REAL FILES, not a fixture. This is the check the server will run before
 * serving anybody a body, so it has to hold for the bodies we already ship —
 * and if it ever stops holding, one of those files changed.
 */
describe("the bodies this repo actually serves", () => {
  it("every one of them passes the check the server applies", () => {
    for (const slug of ["shiro", "observer", "cool-fridge", "crowley", "alienteen", "lydia"]) {
      const bytes = readFileSync(resolve(import.meta.dirname, `../public/avatars/${slug}.vrm`));
      const meta = readVrmMeta(new Uint8Array(bytes));
      expect(meta, slug).not.toHaveProperty("error");
      expect(whyNotUsable(meta as VrmMeta), slug).toBeNull();
    }
  });

  it("reads them from the head alone, as the catalogue tool does", () => {
    // 96KB, not 1.7MB. If this ever fails, some file's JSON chunk grew past
    // the window and the catalogue build will start recording holes.
    const bytes = readFileSync(resolve(import.meta.dirname, "../public/avatars/shiro.vrm"));
    const head = new Uint8Array(bytes).subarray(0, 96 * 1024);
    expect(whyNotUsable(readVrmMeta(head) as VrmMeta)).toBeNull();
  });
});
