export type Config = {
  webharnessUrl: string;
  port: number;
  host?: string;
  cookieName: string;
  sessionTtlMs: number;
  secureCookies: boolean;
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

  return {
    webharnessUrl,
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    cookieName: env.SESSION_COOKIE_NAME ?? "fxg_sid",
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
    secureCookies: production,
  };
}
