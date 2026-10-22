/**
 * BROTLI COPIES OF THE BUILT SITE, made once here so the server never
 * compresses anything while someone waits (server/static-files.ts serves them).
 *
 * NOTHING COMPRESSED THE SITE BEFORE THIS. nginx's gzip covers text/html only
 * (gzip_types is commented out in the box's shared nginx.conf), and
 * @fastify/static sends files as they are. So the "157 KB gzipped" first load
 * we counted was ~500 KB on the wire, three times what it needed to be.
 * Measured on dist, 2026-10-22: JS 9.0 MB to 2.2 MB, the
 * avatars 36.5 MB to 15.4 MB, their animations 6.4 MB to 3.0 MB.
 *
 * Text gets brotli's best (quality 11: the 2 MB music room chunk takes ~3 s
 * and comes out a quarter smaller than gzip). Models get quality 9, because
 * 11 takes forty times as long on a 6 MB avatar for 1% less. Pictures, fonts
 * and sound are compressed already and are left alone.
 *
 * A COPY IS KEPT PER CONTENT, so a build where few chunks changed costs a
 * few seconds rather than a minute: node_modules/.cache/precompress/, keyed by
 * the file's hash and the quality, pruned after two weeks unused.
 *
 *   tsx tools/precompress.mts dist        # (the last step of `pnpm run build`)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { compressibleKind, SMALLEST_WORTH_COMPRESSING, WORTH_KEEPING } from "../shared/compressible.ts";

const UNUSED_FOR_MS = 14 * 24 * 3600 * 1000;

export function qualityFor(file: string): number | null {
  const kind = compressibleKind(file);
  return kind === "text" ? 11 : kind === "model" ? 9 : null;
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

export function precompress(root: string, cache: string): { files: number; raw: number; brotli: number } {
  mkdirSync(cache, { recursive: true });
  const totals = { files: 0, raw: 0, brotli: 0 };
  for (const file of [...files(root)]) {
    if (file.endsWith(".br")) continue;
    const quality = qualityFor(file);
    if (quality === null) continue;
    const bytes = readFileSync(file);
    if (bytes.length < SMALLEST_WORTH_COMPRESSING) continue;
    const kept = join(cache, `${createHash("sha256").update(bytes).digest("hex")}.q${quality}.br`);
    if (existsSync(kept)) {
      const now = new Date();
      utimesSync(kept, now, now);
    } else {
      writeFileSync(kept, brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
      }));
    }
    const size = statSync(kept).size;
    if (size > bytes.length * WORTH_KEEPING) continue;
    copyFileSync(kept, `${file}.br`);
    totals.files += 1;
    totals.raw += bytes.length;
    totals.brotli += size;
  }
  for (const old of readdirSync(cache)) {
    const path = join(cache, old);
    if (Date.now() - statSync(path).mtimeMs > UNUSED_FOR_MS) rmSync(path, { force: true });
  }
  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.argv[2] ?? "dist");
  if (!existsSync(join(root, "index.html"))) {
    console.error(`precompress: no built site at ${root}`);
    process.exit(1);
  }
  const started = Date.now();
  const done = precompress(root, resolve("node_modules/.cache/precompress"));
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`precompress: ${done.files} files, ${mb(done.raw)} MB to ${mb(done.brotli)} MB brotli, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
