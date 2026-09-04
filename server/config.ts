export type Config = {
  webharnessUrl: string;
  port: number;
  host?: string;
  /** Optional same-origin mount, for example /space beside classic chat. */
  basePath?: string;
  cookieName: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  /**
   * Where sessions live. A path uses SQLite so they survive a restart; ":memory:"
   * keeps them in-process and loses them, which is right for tests and local
   * work but never for a deployment.
   */
  sessionStorePath: string;
  /** Explicit WebHarness usernames allowed to mutate project state. */
  projectMutators: string[];
};

/**
 * Read config from the environment, failing fast rather than booting with an
 * insecure default. A BFF that silently starts without a real session secret is
 * worse than one that refuses to start.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const webharnessUrl = env.WEBHARNESS_URL?.replace(/\/$/, "");
  if (!webharnessUrl) {
    throw new Error("WEBHARNESS_URL is required (e.g. https://webharness.example:10443)");
  }

  const production = env.NODE_ENV === "production";
  if (production && !env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production");
  }

  const requestedBasePath = env.APP_BASE_PATH?.trim();
  const basePath = !requestedBasePath || requestedBasePath === "/" ? "" : requestedBasePath.replace(/\/$/, "");
  const pathSegments = basePath.split("/").filter(Boolean);
  if (
    basePath && (
      !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath) ||
      pathSegments.some((segment) => segment === "." || segment === "..")
    )
  ) {
    throw new Error("APP_BASE_PATH must be an absolute URL path such as /space");
  }

  return {
    webharnessUrl,
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    basePath,
    cookieName: env.SESSION_COOKIE_NAME ?? "fxg_sid",
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
    secureCookies: production,
    // Production defaults to a file so a container restart does not sign
    // everyone out; development defaults to memory so nobody accumulates
    // stray database files while iterating.
    sessionStorePath: env.SESSION_STORE_PATH ?? (production ? "./data/sessions.db" : ":memory:"),
    projectMutators: (env.PROJECT_MUTATORS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  };
}
