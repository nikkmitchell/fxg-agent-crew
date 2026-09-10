import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { BlobStore, MAX_BYTES } from "../db/blobs.js";

/**
 * Uploads are the first thing on saha.ing that cannot be rebuilt from anywhere
 * else, and the first place a stranger's bytes reach our disk. Both facts are
 * what these tests are about.
 */

let root: string;
let store: BlobStore;

const png = (w = 3, h = 4) => {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(w, 16);
  bytes.writeUInt32BE(h, 20);
  return bytes;
};
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blobs-"));
  store = new BlobStore(openDatabase(":memory:", DatabaseSync), root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("what we will store", () => {
  it("accepts a PNG and reads back exactly what went in", () => {
    const bytes = png();
    const row = store.put("nikk", bytes, "ref.png") as Record<string, unknown>;

    expect(store.read(row.id as string).bytes.equals(bytes)).toBe(true);
  });

  it("records the dimensions it can read", () => {
    const row = store.put("nikk", png(1280, 720)) as Record<string, unknown>;
    expect([row.width, row.height]).toEqual([1280, 720]);
  });

  it("leaves dimensions null rather than guessing", () => {
    // An unknown size lays out on load. A guessed one makes the board jump.
    const row = store.put("nikk", jpeg()) as Record<string, unknown>;
    expect(row.width).toBeNull();
  });
});

describe("what we refuse", () => {
  it("refuses SVG, and says why in words a person can act on", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    expect(() => store.put("nikk", svg, "mood.svg", "image/svg+xml")).toThrow(/carry scripts.*Export it as PNG/s);
  });

  it("refuses a script that merely CLAIMS to be a PNG", () => {
    // The content-type header is whatever the client typed. Only the bytes
    // decide, so a hostile file cannot walk in wearing a hat.
    const hostile = Buffer.from('<svg onload="fetch(`/bff/me`)"></svg>');

    expect(() => store.put("nikk", hostile, "innocent.png", "image/png")).toThrow(/not an image type/);
  });

  it("refuses an empty file", () => {
    expect(() => store.put("nikk", Buffer.alloc(0))).toThrow(/empty/);
  });

  it("refuses something too large, and says how large it was", () => {
    const huge = Buffer.concat([png(), Buffer.alloc(MAX_BYTES)]);
    expect(() => store.put("nikk", huge)).toThrow(/MB; the limit is/);
  });
});

describe("content addressing", () => {
  it("stores identical bytes once, keeping the first uploader's attribution", () => {
    const bytes = png();
    const first = store.put("nikk", bytes, "a.png") as Record<string, unknown>;
    const second = store.put("someone-else", bytes, "b.png") as Record<string, unknown>;

    expect(second.id).toBe(first.id);
    expect(second.uploaded_by).toBe("nikk");
    expect(countFiles(root)).toBe(1);
  });

  it("keeps different images apart", () => {
    store.put("nikk", png(1, 1));
    store.put("nikk", png(2, 2));

    expect(countFiles(root)).toBe(2);
  });

  it("leaves no partial file behind, so a hash never names truncated bytes", () => {
    store.put("nikk", png());
    const stray = allFiles(root).filter((f) => f.endsWith(".part"));

    expect(stray).toEqual([]);
  });
});

describe("when disk and database disagree", () => {
  it("says the bytes are missing rather than pretending the file never existed", () => {
    // A plain 404 here would hide a real problem: the row exists, so this is a
    // backup or restore fault, and it needs to be noticed rather than absorbed.
    const row = store.put("nikk", png()) as Record<string, unknown>;
    rmSync(root, { recursive: true, force: true });

    expect(() => store.read(row.id as string)).toThrow(/bytes are missing on disk/);
  });

  it("still 404s something that was never uploaded", () => {
    expect(() => store.read("nope")).toThrow(/no such file/);
  });
});

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
const countFiles = (dir: string) => allFiles(dir).length;
