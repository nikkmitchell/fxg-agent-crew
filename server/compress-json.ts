import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { SMALLEST_WORTH_COMPRESSING, accepts } from "../shared/compressible.js";

const gzipped = promisify(gzip);


/**
 * JSON ANSWERS, GZIPPED WHEN ASKED. nginx on the shared box gzips text/html
 * only, and nothing in the app compressed anything, so every /bff answer went
 * as it was: the Work board's lean project read for saha-ing was 323 KB on
 * the wire and the people list 28 KB (measured on live, 2026-10-22). JSON
 * compresses to roughly a third.
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
    if (body.byteLength < SMALLEST_WORTH_COMPRESSING) return payload;
    // Added to a Vary a route already set (a CORS route's "origin"), not put in its place.
    const vary = String(reply.getHeader("vary") ?? "");
    if (!/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary)) reply.header("vary", vary ? `${vary}, accept-encoding` : "accept-encoding");
    // Read as compressible.ts reads it: "gzip;q=0" means never.
    if (!accepts(request.headers["accept-encoding"], "gzip")) return payload;
    const packed = await gzipped(body, { level: 6 });
    reply.header("content-encoding", "gzip");
    reply.removeHeader("content-length");
    return packed;
  });
}
