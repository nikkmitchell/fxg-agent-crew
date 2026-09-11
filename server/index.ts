import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { loadConfig, type Config } from "./config.js";
import { MemorySessionStore, SqliteSessionStore, type SessionStore } from "./session.js";
import { WebharnessClient } from "./webharness/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBuildRoutes } from "./routes/build.js";
import { registerBoardRoutes } from "./routes/board.js";
import { SpaceHub, registerSpaceRoutes } from "./space/socket.js";
import { Activity } from "./space/activity.js";
import { registerStillRoutes } from "./space/stills.js";
import { registerUtteranceRoutes } from "./space/utterances.js";
import { openDatabase } from "./db/open.js";

/**
 * Backend-for-frontend.
 *
 * The UI and its /bff/* are served from ONE origin, which is the point: WebHarness
 * sends no CORS headers and answers preflight OPTIONS with 405, so a browser on
 * a different origin cannot call it at all. Same-origin removes the problem
 * rather than working around it.
 */
/**
 * Choose a session store from config.
 *
 * ":memory:" is explicit rather than implied by an absent path, so a deployment
 * that loses sessions on every restart has to have asked for it.
 */
function createSessionStore(config: Config): SessionStore {
  if (config.sessionStorePath === ":memory:") {
    return new MemorySessionStore(config.sessionTtlMs);
  }
  mkdirSync(dirname(config.sessionStorePath), { recursive: true });
  return new SqliteSessionStore(config.sessionTtlMs, config.sessionStorePath, DatabaseSync);
}

/**
 * Walk up from `start` looking for a built UI. Throws rather than falling back
 * to a guess: a server that boots while serving nothing looks healthy and is
 * useless, and "the API works but every page is 404" is a bad thing to discover
 * from a user.
 */
function findUiRoot(start: string): string {
  for (let dir = start, i = 0; i < 6; i += 1, dir = dirname(dir)) {
    const candidate = resolve(dir, "dist");
    if (existsSync(resolve(candidate, "index.html"))) return candidate;
  }
  throw new Error(
    `no built UI found near ${start} — run \`pnpm run build\` before starting the server`,
  );
}

export function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = Fastify({ logger: { level: config.logLevel } });
  const sessions = createSessionStore(config);

  // saha.ing's own database. Opened once per process and migrated on the way
  // up, so a deploy that changes the schema fails at boot rather than on the
  // first request that touches a new column.
  if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openDatabase(config.databasePath, DatabaseSync);

  /**
   * Uploads arrive as raw bytes.
   *
   * Fastify has no parser for image types, and without one it answers 415
   * before a handler ever runs. Registering the types we actually store — and
   * nothing else — means an unexpected content type is refused by the framework
   * rather than reaching the sniffer as a surprise.
   */
  // The refused types are parsed too, on purpose. Fastify answers an
  // unregistered content type with a bare 415, and the whole value of refusing
  // SVG is the sentence that comes with it — "SVG can carry scripts, export it
  // as PNG". The sniffer in blobs.ts is still the gate; this only decides
  // whether the person gets an answer or a status code.
  for (const mime of [
    "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
    "application/octet-stream", "image/svg+xml", "text/html",
  ]) {
    app.addContentTypeParser(mime, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }
  const client = new WebharnessClient(config.webharnessUrl);

  app.register(cookie);
  // Registered at the root so the upgrade handler sees every request. The route
  // itself is declared inside the prefixed block below, so it moves with the
  // base path like everything else.
  app.register(websocket);

  // Who is standing where. In memory, on purpose — see server/space/presence.ts.
  const space = new SpaceHub();

  // What makes them move: the audit table, read forward from the end of it.
  // Started here rather than on the first socket, so an agent that acts while
  // nobody is watching is already in the right place when someone arrives.
  const activity = new Activity(database, space.presence);
  activity.onError = (error) => app.log.error({ error }, "space activity poll failed");
  activity.start();

  // A prefix lets Wilson mount this beside classic chat at /space without
  // stealing its routes. With the default empty prefix, existing URLs remain
  // /bff/* and the app remains a standalone service.
  app.register(async (scoped) => {
    registerAuthRoutes(scoped, config, sessions, client);
    registerRoomRoutes(scoped, config, sessions, client);
    registerProjectRoutes(scoped, config, sessions, client);
    registerBuildRoutes(scoped, config, sessions);
    registerBoardRoutes(scoped, config, sessions, database, config.blobRoot);
    registerSpaceRoutes(scoped, config, sessions, space);
    registerStillRoutes(scoped, config, sessions);
    registerUtteranceRoutes(scoped, config, sessions, database, (utterance) =>
      space.broadcast({ type: "said", utterance }),
    );
  }, { prefix: config.basePath ?? "" });

  // Serve the built UI from the same origin as the API.
  // Resolve the UI bundle by SEARCHING upward rather than assuming a fixed
  // depth. Running from source, this file sits at server/; compiled, it sits
  // at dist-server/server/ — one level deeper. A hardcoded "../dist" is
  // correct in dev and silently 404s the entire UI in production, which is
  // exactly what happened the first time this was built for real.
  const here = dirname(fileURLToPath(import.meta.url));
  const uiRoot = findUiRoot(here);
  const basePath = config.basePath ?? "";
  app.register(staticPlugin, {
    root: uiRoot,
    prefix: basePath ? `${basePath}/` : "/",
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith(`${basePath}/bff/`)) return reply.code(404).send({ error: "not found" });
    // /api/ IS RESERVED, and stays reserved now that the app owns `/`.
    //
    // The old mount at /space existed so this service could sit beside classic
    // chat on one origin without capturing its routes, and release.sh asserted
    // that `/` and `/api/rooms` both 404. Chat now lives on its own domain, so
    // the mount is gone — but the REASON for it is not. Without this, the SPA
    // fallback answers /api/anything with the app, and the day something else
    // is served from this origin we have the capture problem back, silently.
    //
    // Cheap to keep, expensive to rediscover.
    if (/^\/api(\/|$)/.test(new URL(request.url, "http://placeholder").pathname)) {
      return reply.code(404).send({ error: "not found" });
    }
    if (basePath && request.url === basePath) return reply.redirect(`${basePath}/`);
    if (basePath && !request.url.startsWith(`${basePath}/`)) return reply.code(404).send({ error: "not found" });
    // A MISSING FILE MUST 404, not quietly become the app.
    //
    // The fallback exists so /board and /people reach the SPA. Applying it to
    // everything meant a missing asset answered 200 with index.html, and the
    // browser then refused it: "Expected a JavaScript-or-Wasm module script but
    // the server responded with a MIME type of text/html". The page renders
    // BLANK. Nothing on screen, nothing in the server log, a 200 in the access
    // log — the only evidence is a console message nobody is looking at.
    //
    // It is reachable in production: a browser holding a cached index.html
    // after a deploy asks for the previous build's hashed asset. That request
    // deserves a 404, which a browser understands, rather than a 200 that
    // leaves it staring at HTML it cannot execute.
    //
    // A path whose last segment has an extension is asking for a file. App
    // routes do not carry one.
    if (/\.[a-zA-Z0-9]+$/.test(new URL(request.url, "http://placeholder").pathname)) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });

  // Stop the tick loop when the server does. The timer is unref'd so it would
  // not hold the process open anyway, but a loop still broadcasting into
  // half-closed sockets during shutdown produces errors that look like bugs.
  app.addHook("onClose", async () => {
    activity.stop();
    space.close();
  });

  // `sessions` is returned so a test can sign somebody in without a real
  // upstream. Deliberately not a back door into a running server: this is the
  // value the process already holds, handed to whoever constructed it.
  return { app, config, sessions, database, space, activity };
}

// Only listen when run directly, so tests can build the server without binding.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { app, config } = buildServer();
  app.listen({ port: config.port, host: config.host ?? "127.0.0.1" }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
