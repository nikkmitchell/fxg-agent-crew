import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import { acceptsBrotli, compressibleKind, SMALLEST_WORTH_COMPRESSING, WORTH_KEEPING } from "../shared/compressible.js";

const brotli = promisify(brotliCompress);

/**
 * BROTLI COPIES OF FILES THE SERVER WAS GIVEN RATHER THAN BUILT: spaces'
 * deployed files and catalogue bodies, both in the state directory (the only
 * place the service may write). The built site has its copies made at build
 * (tools/precompress.mts); these are made the first time a file is asked
 * for, in the background, so that asker gets the plain file and everyone
 * after gets the copy. A deploy that is cleared takes its copies with it.
 *
 * QUALITY 5, NOT THE BUILD'S 11. Measured: 13 ms for the 760 KB Scene chunk
 * (233 KB, against 209 KB at 11, which takes 1.1 s) and 46 ms for a 5.7 MB
 * body. And ONE AT A TIME: compression runs on libuv's four threads, which
 * every file read also needs, so it never takes more than one of them.
 *
 * A copy appears whole or not at all (written aside, then renamed), because
 * @fastify/static serves FILE.br the moment it exists.
 */
export class BrotliCopies {
  private queue: Promise<unknown> = Promise.resolve();
  /** Each file's one attempt in this process (made, judged not worth it, or under way), so each is read for this once. */
  private readonly tried = new Map<string, Promise<boolean>>();

  /** Make FILE.br in the background, once. Resolves true when a copy is there to serve. */
  make(file: string): Promise<boolean> {
    if (!compressibleKind(file)) return Promise.resolve(false);
    const earlier = this.tried.get(file);
    if (earlier) return earlier;
    // Bounded by the files on disk, but a process lives for weeks: forget rather than grow.
    if (this.tried.size >= 50_000) this.tried.clear();
    const job = this.queue.then(async () => {
      const [plain, made] = await Promise.all([stat(file), stat(`${file}.br`).catch(() => null)]);
      if (made && made.mtimeMs >= plain.mtimeMs) return true;
      if (plain.size < SMALLEST_WORTH_COMPRESSING) return false;
      const bytes = await readFile(file);
      const packed = await brotli(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
      });
      if (packed.length > bytes.length * WORTH_KEEPING) return false;
      const aside = `${file}.br.making-${process.pid}`;
      await writeFile(aside, packed);
      await rename(aside, `${file}.br`);
      return true;
    }).catch(() => false); // A deploy cleared meanwhile, a full disk: the plain file still serves.
    this.tried.set(file, job);
    this.queue = job;
    return job;
  }

  /**
   * For a route that streams a file itself: the copy to send instead of FILE
   * (with content-encoding: br), or null to send FILE as it is, in which case
   * one is made for next time.
   */
  async copyFor(acceptEncoding: string | string[] | undefined, file: string): Promise<string | null> {
    if (!acceptsBrotli(acceptEncoding) || !compressibleKind(file)) return null;
    const copy = `${file}.br`;
    const [plain, made] = await Promise.all([stat(file).catch(() => null), stat(copy).catch(() => null)]);
    if (plain && made?.isFile() && made.mtimeMs >= plain.mtimeMs) return copy;
    void this.make(file);
    return null;
  }
}
