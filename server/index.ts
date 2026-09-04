import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import { loadConfig } from "./config.js";
import { SessionStore } from "./session.js";
import { WebharnessClient } from "./webharness/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRoomRoutes } from "./routes/rooms.js";

/**
 * Backend-for-frontend.
 *
 * The UI and its /bff/* are served from ONE origin, which is the point: WebHarness
 * sends no CORS headers and answers preflight OPTIONS with 405, so a browser on
 * a different origin cannot call it at all. Same-origin removes the problem
 * rather than working around it.
 */
export function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = Fastify({ logger: true });
  const sessions = new SessionStore(config.sessionTtlMs);
  const client = new WebharnessClient(config.webharnessUrl);

  app.register(cookie);

  // A prefix lets Wilson mount this beside classic chat at /space without
  // stealing its routes. With the default empty prefix, existing URLs remain
  // /bff/* and the app remains a standalone service.
  app.register(async (scoped) => {
    registerAuthRoutes(scoped, config, sessions, client);
    registerRoomRoutes(scoped, config, sessions, client);
  }, { prefix: config.basePath ?? "" });

  // Serve the built UI from the same origin as the API.
  const here = dirname(fileURLToPath(import.meta.url));
  const basePath = config.basePath ?? "";
  app.register(staticPlugin, {
    root: resolve(here, "../dist"),
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
