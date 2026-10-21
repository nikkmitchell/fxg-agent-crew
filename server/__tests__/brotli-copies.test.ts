import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BrotliCopies } from "../brotli-copies.js";
import { acceptsBrotli, compressibleKind } from "../../shared/compressible.js";
import { tempDir } from "./test-config.js";

const BROWSER = "gzip, deflate, br, zstd";
const model = Buffer.from("vertex 0.125 0.250 0.500\n".repeat(4000));

describe("which clients take brotli", () => {
  it("reads Accept-Encoding the way browsers, curl and urllib send it", () => {
    expect(acceptsBrotli(BROWSER)).toBe(true);
    expect(acceptsBrotli("BR")).toBe(true);
    expect(acceptsBrotli("gzip;q=1.0, br;q=0.5")).toBe(true);
    expect(acceptsBrotli("br;q=0"), "q=0 means never").toBe(false);
    expect(acceptsBrotli("gzip, deflate")).toBe(false);
    expect(acceptsBrotli("brotli")).toBe(false);
    expect(acceptsBrotli(undefined), "curl and urllib send nothing").toBe(false);
    expect(acceptsBrotli(["gzip", "br"])).toBe(true);
  });

  it("knows a file worth compressing by its name", () => {
    expect(compressibleKind("things/desert/quiver_tree_01.bin")).toBe("model");
    expect(compressibleKind("avatars/knight.VRM")).toBe("model");
    expect(compressibleKind("app.js")).toBe("text");
    expect(compressibleKind("sky/goegap.jpg")).toBeNull();
    expect(compressibleKind("v1.2/README")).toBeNull();
  });
});

describe("brotli copies of files the server was given", () => {
  it("makes FILE.br in the background, which decodes to the file", async () => {
    const dir = tempDir("copies-");
    const file = join(dir, "orb.glb");
    writeFileSync(file, model);
    const copies = new BrotliCopies();
    expect(await copies.copyFor(BROWSER, file), "the first asker gets the plain file").toBeNull();
    expect(await copies.make(file), "and the copy is made meanwhile").toBe(true);
    expect(await copies.copyFor(BROWSER, file)).toBe(`${file}.br`);
    expect(brotliDecompressSync(readFileSync(`${file}.br`)).equals(model)).toBe(true);
  });

  it("sends nothing compressed to a client that did not ask, and makes nothing for it", async () => {
    const dir = tempDir("copies-");
    const file = join(dir, "orb.glb");
    writeFileSync(file, model);
    const copies = new BrotliCopies();
    expect(await copies.copyFor(undefined, file)).toBeNull();
    await new Promise((settle) => setTimeout(settle, 50));
    expect(existsSync(`${file}.br`)).toBe(false);
  });

  it("leaves pictures, tiny files and noise alone", async () => {
    const dir = tempDir("copies-");
    const write = (name: string, bytes: Buffer) => (writeFileSync(join(dir, name), bytes), join(dir, name));
    const copies = new BrotliCopies();
    expect(await copies.make(write("sky.jpg", model)), "a picture is compressed already").toBe(false);
    expect(await copies.make(write("tiny.js", Buffer.from("export {};\n")))).toBe(false);
    expect(await copies.make(write("noise.bin", randomBytes(64 * 1024))), "would not save a tenth").toBe(false);
    for (const name of ["sky.jpg", "tiny.js", "noise.bin"]) expect(existsSync(join(dir, `${name}.br`)), name).toBe(false);
  });

  it("never sends a copy older than its file", async () => {
    const dir = tempDir("copies-");
    const file = join(dir, "orb.glb");
    writeFileSync(file, model);
    await new BrotliCopies().make(file);
    // The file changed after its copy was made (a body fetched again, say).
    const earlier = new Date(Date.now() - 3_600_000);
    utimesSync(`${file}.br`, earlier, earlier);
    const copies = new BrotliCopies();
    expect(await copies.copyFor(BROWSER, file)).toBeNull();
    await copies.make(file);
    expect(await copies.copyFor(BROWSER, file)).toBe(`${file}.br`);
  });

  it("carries on when the file is gone before its turn (a deploy cleared)", async () => {
    const copies = new BrotliCopies();
    expect(await copies.make(join(tempDir("copies-"), "gone.glb"))).toBe(false);
    const dir = tempDir("copies-");
    writeFileSync(join(dir, "next.glb"), model);
    expect(await copies.make(join(dir, "next.glb")), "the queue is not stuck behind it").toBe(true);
  });
});
