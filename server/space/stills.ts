import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { STATIONS } from "../../shared/space-layout.js";

/**
 * Pictures of the real pages, for the headset.
 *
 * A headset session draws 3D only, so the live panels cannot be in it — see
 * docs/HEADSET-CHECKS.md. A separate process drives a headless browser over the
 * same pages and writes PNGs; this serves them, and tells that process when
 * anybody actually wants one.
 *
 * WHAT THIS IS NOT: it is not a second renderer. Nothing here knows what a card
 * looks like. It is a photograph of the page everyone else uses, which is why
 * it cannot drift from it.
 *
 * WHAT IT COSTS IN HONESTY: a still is a few seconds old and cannot be clicked.
 * The scene labels it as a snapshot rather than letting it pass for the live
 * thing, because a board that is quietly stale is worse than one that is
 * obviously a picture.
 */

/** Which tabs get photographed. Exactly the panels, so the two cannot diverge. */
export const STILL_TABS = Object.values(STATIONS).map((station) => station.tab);

/**
 * How long after somebody asks we keep re-rendering.
 *
 * The renderer does nothing unless this file is fresh, so an idle box runs no
 * browser at all. Two minutes outlives a dropped frame or a slow headset
 * without keeping Chrome alive for an afternoon.
 */
export const DEMAND_WINDOW_MS = 120_000;

const stillPath = (root: string, tab: string) => resolve(root, `${tab}.png`);
const demandPath = (root: string) => resolve(root, "wanted");

/** Record that a still was asked for, so the renderer knows to keep going. */
export function noteDemand(root: string): void {
  mkdirSync(root, { recursive: true });
  const path = demandPath(root);
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // First ask: the file does not exist yet.
    writeFileSync(path, "someone is looking at the stills\n");
  }
}

/** Has anybody asked recently? Read by the renderer, not by the app. */
export function stillsAreWanted(root: string, now = Date.now()): boolean {
  try {
    return now - statSync(demandPath(root)).mtimeMs < DEMAND_WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * Constant-time secret comparison.
 *
 * Hashed first so the comparison is over equal lengths — `timingSafeEqual`
 * throws on a length mismatch, and throwing on the wrong length is itself a
 * length oracle.
 */
function secretMatches(given: string, expected: string): boolean {
  if (expected === "") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Loopback only.
 *
 * `request.ip` is the socket's address; nginx proxies from 127.0.0.1, so a
 * request that arrives through it looks local too. That is why the shared
 * secret exists as well — being on the box is not by itself authority, and
 * neither is arriving through the proxy.
 */
function fromLoopback(request: FastifyRequest): boolean {
  return request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
}

export function registerStillRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
): void {
  /**
   * A session for the renderer.
   *
   * THIS MINTS A SESSION WITHOUT A PASSWORD, so read the guards: loopback only,
   * and only with the shared secret, which is empty — and therefore refuses
   * everything — unless STILLS_TOKEN was deliberately set.
   *
   * BLAST RADIUS, stated because it will not stay true by itself: the `render`
   * actor can read whatever any signed-in person can read. That is acceptable
   * only because reads in this product take no authority argument — every
   * signed-in person already sees the same board. The day reads become gated
   * per project or per person, this becomes a way to photograph things the
   * viewer is not entitled to, and it must be revisited then. It is listed in
   * docs/OPERATING-NOTES.md for that reason.
   */
  app.post("/bff/space/render-session", async (request, reply) => {
    if (!fromLoopback(request) || !secretMatches(String(request.headers["x-stills-token"] ?? ""), config.stillsToken)) {
      // Deliberately the same answer for "wrong secret", "not local" and "not
      // configured": a distinct message for each tells a prober which one they
      // have got past.
      return reply.code(404).send({ code: "NOT_FOUND", error: "not found" });
    }
    const sid = sessions.create("render", "", "agent");
    return reply.send({ cookie: `${config.cookieName}=${sid}` });
  });

  /**
   * One photograph.
   *
   * Requires an ordinary session, like every other read here — the pictures are
   * of pages a signed-out person may not see, so the pictures are not public
   * either.
   */
  app.get<{ Params: { tab: string } }>("/bff/space/stills/:tab.png", async (request, reply) => {
    if (!sessions.get(request.cookies[config.cookieName])) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });
    }
    const tab = request.params.tab;
    // An allowlist, not a sanitiser: the tab name becomes a path, and the only
    // safe way to put caller input in a path is to not put caller input in a
    // path.
    if (!STILL_TABS.includes(tab)) {
      return reply.code(404).send({ code: "NOT_FOUND", error: "no such panel" });
    }

    // Asking is what keeps the renderer awake, so it is recorded even when we
    // have nothing to send back yet.
    noteDemand(config.stillsRoot);

    try {
      const bytes = readFileSync(stillPath(config.stillsRoot, tab));
      const age = Math.round((Date.now() - statSync(stillPath(config.stillsRoot, tab)).mtimeMs) / 1000);
      return reply
        .header("content-type", "image/png")
        // Never cached: the whole point is that it changes. The age is sent so
        // the scene can say how old the picture is rather than implying it is
        // live.
        .header("cache-control", "no-store")
        .header("x-still-age-seconds", String(age))
        .send(bytes);
    } catch {
      // Nothing rendered yet. 503 rather than 404: the panel exists, the
      // picture is coming, and the client should try again.
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ code: "NOT_RENDERED_YET", error: "no picture of that panel yet" });
    }
  });
}
