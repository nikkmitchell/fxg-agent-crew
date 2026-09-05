import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import { loadConfig, type Config } from "./config.js";
import { MemorySessionStore, SqliteSessionStore, type SessionStore } from "./session.js";
import { WebharnessClient } from "./webharness/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBuildRoutes } from "./routes/build.js";

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
  const app = Fastify({ logger: true });
  const sessions = createSessionStore(config);
  const client = new WebharnessClient(config.webharnessUrl);

  app.register(cookie);

  // A prefix lets Wilson mount this beside classic chat at /space without
  // stealing its routes. With the default empty prefix, existing URLs remain
  // /bff/* and the app remains a standalone service.
  app.register(async (scoped) => {
    registerAuthRoutes(scoped, config, sessions, client);
    registerRoomRoutes(scoped, config, sessions, client);
    registerProjectRoutes(scoped, config, sessions, client);
    registerBuildRoutes(scoped, config, sessions);
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
    if (basePath && request.url === basePath) return reply.redirect(`${basePath}/`);
    if (basePath && !request.url.startsWith(`${basePath}/`)) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });

  return { app, config };
}

// Only listen when run directly, so tests can build the server without binding.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { app, config } = buildServer();
  app.listen({ port: config.port, host: config.host ?? "127.0.0.1" }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
