import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { BodyFiles } from "../space/body-files.js";
import { DRIVEN_BONES } from "../../shared/vrm-meta.js";

/** A .glb carrying whatever metadata the test wants to assert about. */
const glb = (meta: Record<string, unknown>, bones = DRIVEN_BONES.map((bone) => ({ bone }))): Uint8Array => {
  const json = { extensions: { VRM: { meta, humanoid: { humanBones: bones } } } };
  const body = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(body.length / 4) * 4).fill(0x20);
  padded.set(body);
  const out = new Uint8Array(20 + padded.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  return out;
};

const CC0 = { licenseName: "CC0", allowedUserName: "Everyone", commercialUssageName: "Allow", title: "Abissal Dude" };

const catalogue = { abissaldude: { name: "AbissalDude", model: "https://arweave.net/abc" } };

/** A fetch that serves bytes and counts how often it was called. */
const serving = (bytes: Uint8Array, status = 200) => {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-length": String(bytes.length) }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
};

const cache = () => mkdtempSync(resolve(tmpdir(), "bodies-"));
const look = (key: string) => (catalogue as Record<string, { name: string; model: string }>)[key] ?? null;

describe("fetching a body from the collection", () => {
  it("fetches it once, keeps it, and serves the second request off disk", async () => {
    const bytes = glb(CC0);
    const { impl, calls } = serving(bytes);
    const root = cache();
    const files = new BodyFiles(root, look, impl);

    const first = await files.want("AbissalDude");
    expect(first).toMatchObject({ ok: true, fetched: true });
    const second = await files.want("abissaldude");
    expect(second, "the second request must not go out to the network").toMatchObject({ ok: true, fetched: false });
    expect(calls).toEqual(["https://arweave.net/abc"]);
    expect(readdirSync(root)).toEqual(["abissaldude.vrm"]);
    expect(new Uint8Array(readFileSync(resolve(root, "abissaldude.vrm")))).toEqual(bytes);
  });

  /**
   * Four browsers entering the room together ask for the same body at the same
   * instant. Without one shared fetch they each pull the whole file and three
   * of them write over the finished one.
   */
  it("collapses simultaneous requests for the same body into one fetch", async () => {
    const { impl, calls } = serving(glb(CC0));
    const files = new BodyFiles(cache(), look, impl);
    const all = await Promise.all([1, 2, 3, 4].map(() => files.want("AbissalDude")));
    expect(all.every((one) => one.ok)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("leaves no part file behind", async () => {
    // A half-written file at the real path would pass the on-disk check for
    // ever and fail to parse in somebody's browser, with nothing to say why.
    const root = cache();
    const { impl } = serving(glb(CC0));
    await new BodyFiles(root, look, impl).want("AbissalDude");
    expect(readdirSync(root).filter((name) => name.includes(".part"))).toEqual([]);
  });
});

/**
 * THE LICENCE IS CHECKED FROM THE BYTES IN HAND, not from the catalogue's
 * record of what was once true. And a file we will not serve is never kept:
 * cached, the next reader would find it on disk and serve it unchecked.
 */
describe("refusing a file we will not serve", () => {
  const refuses = async (bytes: Uint8Array, expected: RegExp) => {
    const root = cache();
    const files = new BodyFiles(root, look, serving(bytes).impl);
    const result = await files.want("AbissalDude");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(expected);
    expect(readdirSync(root), "a refused body must not be cached").toEqual([]);
    return result;
  };

  it("refuses a licence that is not CC0, whatever the catalogue said", async () => {
    await refuses(glb({ ...CC0, licenseName: "CC_BY_NC" }), /CC_BY_NC/);
  });

  it("refuses a body its author did not release to Everyone", async () => {
    await refuses(glb({ ...CC0, allowedUserName: "OnlyAuthor" }), /OnlyAuthor/);
  });

  it("refuses a rig missing a bone this room poses, naming it", async () => {
    await refuses(glb(CC0, [{ bone: "hips" }]), /leftHand/);
  });

  it("refuses something that is not a VRM at all", async () => {
    await refuses(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), /not a glb/);
  });
});

describe("what cannot be asked for", () => {
  it("404s a name that is not in the catalogue, without opening a socket", async () => {
    const { impl, calls } = serving(glb(CC0));
    const result = await new BodyFiles(cache(), look, impl).want("NotARealBody");
    expect(result).toMatchObject({ ok: false, code: 404 });
    expect(calls, "nothing a caller sends may become a request").toEqual([]);
  });

  it("404s a body that ships with the site, rather than fetching a second copy", async () => {
    // Two URLs for one file means a headset downloading it twice — fine-looking
    // and twice the bytes.
    const result = await new BodyFiles(cache(), look, serving(glb(CC0)).impl).want("shiro");
    expect(result).toMatchObject({ ok: false, code: 404 });
    expect(!result.ok && result.error).toContain("/avatars/shiro.vrm");
  });

  it("404s an empty name", async () => {
    expect(await new BodyFiles(cache(), look, serving(glb(CC0)).impl).want("")).toMatchObject({ ok: false, code: 404 });
  });

  it("says the COLLECTION failed, not that this site did", async () => {
    // The machine this was written on has a proxy that dies and returns, and
    // two wrong diagnoses came from exactly this confusion.
    const { impl } = serving(glb(CC0), 503);
    const result = await new BodyFiles(cache(), look, impl).want("AbissalDude");
    expect(result).toMatchObject({ ok: false, code: 502 });
    expect(!result.ok && result.error).toMatch(/collection answered 503/);
  });

  it("reports an unreachable collection as unreachable", async () => {
    const dead = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const result = await new BodyFiles(cache(), look, dead).want("AbissalDude");
    expect(result).toMatchObject({ ok: false, code: 502 });
    expect(!result.ok && result.error).toMatch(/could not reach the collection/);
  });

  it("refuses an absurdly large file on its declared length, before reading it", async () => {
    const huge = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(500 * 1024 * 1024) }),
      arrayBuffer: async () => {
        throw new Error("must not be read");
      },
    })) as unknown as typeof fetch;
    const result = await new BodyFiles(cache(), look, huge).want("AbissalDude");
    expect(result).toMatchObject({ ok: false, code: 502 });
  });
});

describe("a body already on disk", () => {
  it("is served without a fetch even if the collection is unreachable", async () => {
    // The point of caching: onboarding must not depend on somebody else's
    // uptime once the file is here.
    const root = cache();
    writeFileSync(resolve(root, "abissaldude.vrm"), glb(CC0));
    const dead = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    expect(await new BodyFiles(root, look, dead).want("AbissalDude")).toMatchObject({ ok: true, fetched: false });
  });

  it("is re-fetched if what is on disk is empty", async () => {
    // A zero-byte file is the shape a crashed write leaves behind.
    const root = cache();
    writeFileSync(resolve(root, "abissaldude.vrm"), new Uint8Array());
    const { impl, calls } = serving(glb(CC0));
    expect(await new BodyFiles(root, look, impl).want("AbissalDude")).toMatchObject({ ok: true, fetched: true });
    expect(calls).toHaveLength(1);
  });
});

/**
 * WHERE THE CACHE GOES, which is the thing that actually broke in production.
 *
 * `ProtectSystem=strict` makes the install directory read-only, so the
 * relative production default I first shipped — ./data/bodies — failed with
 * ENOENT the first time anybody picked a new body. The database path is
 * already writable in anything that booted at all, so the cache is derived
 * from it rather than guessed, and nothing has to be remembered on a new box.
 */
describe("where fetched bodies are kept", () => {
  it("sits beside the database, wherever that is", async () => {
    const { loadConfig } = await import("../config.js");
    const config = loadConfig({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: "/var/lib/fxg-crew/saha.db",
    });
    expect(config.bodyCacheRoot).toBe("/var/lib/fxg-crew/bodies");
  });

  it("never lands under the read-only install directory", async () => {
    const { loadConfig } = await import("../config.js");
    const config = loadConfig({
      WEBHARNESS_URL: "https://example.test",
      NODE_ENV: "production",
      SESSION_SECRET: "x",
      DATABASE_PATH: "/var/lib/fxg-crew/saha.db",
    });
    expect(config.bodyCacheRoot.startsWith("/var/lib/")).toBe(true);
    expect(config.bodyCacheRoot).not.toContain("./data");
  });

  it("uses the development directory when the database is in memory", async () => {
    // ":memory:" is not a location, so there is nothing to sit beside.
    const { loadConfig } = await import("../config.js");
    const config = loadConfig({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:" });
    expect(config.bodyCacheRoot).toBe("./.dev-bodies");
  });

  it("still takes an explicit setting when one is given", async () => {
    const { loadConfig } = await import("../config.js");
    const config = loadConfig({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: "/var/lib/fxg-crew/saha.db",
      BODY_CACHE_ROOT: "/srv/elsewhere",
    });
    expect(config.bodyCacheRoot).toBe("/srv/elsewhere");
  });
});
