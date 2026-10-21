import { join, sep } from "node:path";
import type { FastifyStaticOptions } from "@fastify/static";

/** A hashed build file never changes under its name, so it is kept a year. */
export const HASHED_FOR_A_YEAR = "public, max-age=31536000, immutable";

/**
 * How the built site (dist/) is served.
 *
 * COMPRESSED, FROM COPIES MADE AT BUILD: tools/precompress.mts writes a .br
 * beside each file worth it, and `preCompressed` sends that to a browser that
 * accepts brotli (every one we support), or the file itself to anything else
 * (curl, Python's urllib). Before this nothing compressed JS, CSS or the
 * avatars at all; see the top of precompress.mts. The server spends nothing
 * per request, and dynamic answers (the long-poll, the sockets) are untouched.
 *
 * ONLY /assets/ IS KEPT. Vite names everything there by its content, so a
 * year is safe and saves a revalidation per file per visit. Everything else
 * keeps max-age=0: index.html above all, which the page re-reads every 15 s
 * to notice a new build, and /kit/saha.js, /saha.py and the avatars, whose
 * names stay the same when they change.
 */
export function staticFileOptions(root: string, prefix: string): FastifyStaticOptions {
  const assets = join(root, "assets") + sep;
  return {
    root,
    prefix,
    wildcard: false,
    preCompressed: true,
    setHeaders: (reply, path) => {
      if (path.startsWith(assets)) reply.header("cache-control", HASHED_FOR_A_YEAR);
    },
  };
}
