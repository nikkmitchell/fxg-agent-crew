import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { FastifyInstance } from "fastify";

const gzipped = promisify(gzip);

/** Smaller than this, the gzip header and the work outweigh what is saved. */
export const COMPRESS_FROM_BYTES = 1024;

/**
 * JSON ANSWERS, GZIPPED WHEN ASKED. nginx on the shared box gzips text/html
 * only, and nothing in the app compressed anything, so every /bff answer went
 * as it was: the Work board's lean project read for saha-ing was 323 KB on
 * the wire and the people list 28 KB, on a link that carries about 21 KB a
 * second (measured on live, 2026-10-22). JSON compresses to roughly a third.
 *
 * Only finished JSON bodies (a string or Buffer) are touched: streams, files
 * (Kerf's precompressed static assets), the long-poll and the sockets go as
 * they are. A body already encoded, a HEAD request or a client that did not
 * ask for gzip is left alone.
 */
export function compressJson(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "HEAD" || reply.getHeader("content-encoding")) return payload;
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    const type = String(reply.getHeader("content-type") ?? "");
    if (!type.startsWith("application/json")) return payload;
    const body = typeof payload === "string" ? Buffer.from(payload) : payload;
    if (body.byteLength < COMPRESS_FROM_BYTES) return payload;
    reply.header("vary", "accept-encoding");
    if (!/\bgzip\b/.test(String(request.headers["accept-encoding"] ?? ""))) return payload;
    const packed = await gzipped(body, { level: 6 });
    reply.header("content-encoding", "gzip");
    reply.removeHeader("content-length");
    return packed;
  });
}
