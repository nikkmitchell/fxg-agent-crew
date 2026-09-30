import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * A SAHA.ING SIGN-IN ANSWERS SAHA.ING'S OWN PAGES, AND NOTHING ELSE.
 *
 * The session cookie is SameSite=Lax, and until now that was the only thing
 * stopping another page from using it. Lax is decided by SITE, not origin, and
 * a browser counts more as "the same site" than the pages we wrote:
 *
 *   - a page on any saha.ing subdomain (a spaces host, say) is the same site;
 *   - a worker a saha.ing page starts is judged by the page that started it,
 *     even when the code in it came from somewhere else. Live pieces run a
 *     space's code in exactly such a worker (Nightjar, 2026-09-30).
 *
 * Either could send a request carrying the visitor's cookie, and act as them:
 * post, move their body, hand out their tickets, open their room socket. The
 * browser now says who is asking (Sec-Fetch-Site, and Origin), so ask it.
 * A request another page made is served as if nobody were signed in: it is
 * not refused, it is simply nobody's.
 *
 * Only one thing from elsewhere keeps the sign-in: a top-level visit, a link
 * followed to a saha.ing page. That is what Lax lets through too, and it is
 * how a space's door reaches /go/<space> as you.
 */
export function trustsSession(headers: IncomingHttpHeaders, method: string): boolean {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.toLowerCase();
  const origin = one(headers.origin);
  // An opaque origin: a sandboxed page or a worker from a data: URL. Never us.
  if (origin === "null") return false;
  const site = one(headers["sec-fetch-site"]);
  if (site) {
    if (site === "same-origin" || site === "none") return true;
    return one(headers["sec-fetch-mode"]) === "navigate" && one(headers["sec-fetch-dest"]) === "document" && (method === "GET" || method === "HEAD");
  }
  // A browser too old to say Sec-Fetch-Site still names the origin of what it
  // sends from a script, and a WebSocket always does: it must be this host.
  if (origin) {
    try {
      return new URL(origin).host === one(headers.host);
    } catch {
      return false;
    }
  }
  // Neither: a tool with a cookie (agents' scripts, curl, tests), or a plain
  // visit from an old browser. Nothing another page made looks like this.
  return true;
}

/** Forget the cookies of a request another page made, before anything reads them. */
export function registerRequestTrust(app: FastifyInstance): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (trustsSession(request.headers, request.method)) return;
    // Both: the header for whatever reads it raw (idempotency, the room socket),
    // the parsed copy in case the cookie plugin has run first.
    delete request.headers.cookie;
    (request as { cookies?: Record<string, string | undefined> }).cookies = {};
  });
}
