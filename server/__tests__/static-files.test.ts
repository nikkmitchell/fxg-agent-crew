import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { describe, expect, it } from "vitest";
import { HASHED_FOR_A_YEAR, staticFileOptions } from "../static-files.js";
import { precompress, qualityFor } from "../../tools/precompress.mts";
import { tempDir } from "./test-config.js";

/**
 * Serving the built site compressed.
 *
 * Found on live, 2026-10-22: every JS and CSS file went out as it was, though
 * the browser asked for gzip, because nothing in front of the files compressed
 * them. These drive a built-looking dist through the real precompress and the
 * real static options, and decode what a browser would get.
 */
const script = `export const room = ${JSON.stringify("the same words again and again ".repeat(400))};\n`;

function builtSite() {
  const root = tempDir("dist-");
  mkdirSync(join(root, "assets"));
  mkdirSync(join(root, "kit"));
  writeFileSync(join(root, "index.html"), `<!doctype html><title>saha.ing</title>${"<p>words</p>".repeat(200)}`);
  writeFileSync(join(root, "assets", "index-AbCd1234.js"), script);
  writeFileSync(join(root, "assets", "tiny-Zz9Yy8Xx.js"), "export {};\n");
  writeFileSync(join(root, "assets", "photo-Qq1Ww2Ee.jpg"), Buffer.alloc(4096, 7));
  writeFileSync(join(root, "kit", "saha.js"), script);
  return root;
}

async function serve(root: string) {
  precompress(root, tempDir("precompress-cache-"));
  const app = Fastify({ logger: false });
  await app.register(staticPlugin, staticFileOptions(root, "/"));
  return app;
}

const BROWSER = { "accept-encoding": "gzip, deflate, br, zstd" };

describe("the built site, compressed", () => {
  it("sends a browser the brotli copy, which decodes to the file itself", async () => {
    const app = await serve(builtSite());
    const response = await app.inject({ url: "/assets/index-AbCd1234.js", headers: BROWSER });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.headers.vary).toMatch(/accept-encoding/i);
    expect(response.rawPayload.length, "smaller on the wire").toBeLessThan(script.length / 4);
    expect(brotliDecompressSync(response.rawPayload).toString()).toBe(script);
    await app.close();
  });

  it("sends the file itself to anything that did not ask (curl, urllib)", async () => {
    const app = await serve(builtSite());
    const response = await app.inject({ url: "/assets/index-AbCd1234.js" });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body).toBe(script);
    await app.close();
  });

  it("keeps hashed assets for a year, and nothing else", async () => {
    const app = await serve(builtSite());
    for (const headers of [BROWSER, {}]) {
      expect((await app.inject({ url: "/assets/index-AbCd1234.js", headers })).headers["cache-control"]).toBe(HASHED_FOR_A_YEAR);
    }
    // index.html is re-read every 15 s to notice a new build; the kit keeps its name when it changes.
    for (const url of ["/", "/index.html", "/kit/saha.js"]) {
      const response = await app.inject({ url, headers: BROWSER });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["cache-control"], url).toBe("public, max-age=0");
    }
    await app.close();
  });

  it("compresses the page itself too, and serves it as HTML", async () => {
    const app = await serve(builtSite());
    const response = await app.inject({ url: "/", headers: BROWSER });
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(brotliDecompressSync(response.rawPayload).toString()).toContain("<title>saha.ing</title>");
    await app.close();
  });

  it("leaves pictures and tiny files alone, and still serves them", async () => {
    const root = builtSite();
    const app = await serve(root);
    expect(existsSync(join(root, "assets", "photo-Qq1Ww2Ee.jpg.br"))).toBe(false);
    expect(existsSync(join(root, "assets", "tiny-Zz9Yy8Xx.js.br"))).toBe(false);
    const tiny = await app.inject({ url: "/assets/tiny-Zz9Yy8Xx.js", headers: BROWSER });
    expect(tiny.statusCode).toBe(200);
    expect(tiny.headers["content-encoding"]).toBeUndefined();
    expect(tiny.body).toBe("export {};\n");
    await app.close();
  });
});

describe("precompress", () => {
  it("chooses by kind: text at brotli's best, models a little lower, pictures not at all", () => {
    expect(qualityFor("a.js")).toBe(11);
    expect(qualityFor("a.CSS")).toBe(11);
    expect(qualityFor("body.vrm")).toBe(9);
    expect(qualityFor("photo.jpg")).toBeNull();
    expect(qualityFor("font.woff2")).toBeNull();
  });

  it("makes the same copy from its cache as from scratch", () => {
    const cache = tempDir("precompress-cache-");
    const first = builtSite();
    const second = builtSite();
    const made = precompress(first, cache);
    const kept = precompress(second, cache);
    expect(kept).toEqual(made);
    const copy = (root: string) => readFileSync(join(root, "assets", "index-AbCd1234.js.br"));
    expect(copy(second).equals(copy(first))).toBe(true);
  });
});
