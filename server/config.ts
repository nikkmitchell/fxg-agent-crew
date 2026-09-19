import { dirname, resolve } from "node:path";

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
  /**
   * saha.ing's own database — the board, people, mood boards. See ADR-002.
   *
   * ":memory:" is right for tests and wrong for anything else, so production
   * gets a real path under StateDirectory and never a default that silently
   * loses everything on restart.
   */
  databasePath: string;
  /** Where uploaded bytes live. The one thing here that cannot be rebuilt. */
  blobRoot: string;
  /** Pino level. "silent" exists so tests that bind a port stay readable. */
  logLevel: string;
  /** Where the still renderer writes its PNGs, and the app reads them from. */
  stillsRoot: string;
  /**
   * Where bodies fetched from the avatar collection are kept.
   *
   * A CACHE, not data: every file here can be pulled again from the address in
   * public/avatars/catalogue.json, so losing it costs one slow first load per
   * body and nothing else — unlike the blobs, which cannot be rebuilt.
   *
   * DEFAULTS TO A DIRECTORY BESIDE THE DATABASE, rather than under `./data`
   * like the settings above it, and that is the second time this lesson has
   * been paid for. `ProtectSystem=strict` in the systemd unit makes the
   * install directory READ-ONLY, so any relative production default is
   * unwritable. The unit's own comment says exactly that about
   * SESSION_STORE_PATH, which crashed the service on boot until somebody set
   * it explicitly.
   *
   * I shipped `./data/bodies` anyway and it failed on the live site the first
   * time a new body was picked: ENOENT, mkdir /opt/fxg-crew/data. Every other
   * path here is corrected by hand in an environment file on the box, which
   * works and must be remembered again on every new machine. The database path
   * is already writable in anything that booted at all, so deriving from it is
   * correct by construction rather than by memory.
   */
  bodyCacheRoot: string;
  /**
   * Where synthesised speech is kept, derived from the database path for the
   * same reason as the bodies: a line costs a core-second to say and the same
   * line in the same voice is the same sound for ever.
   */
  speechCacheRoot: string;
  /**
   * Shared secret for the loopback-only render-session endpoint. EMPTY DISABLES
   * IT, which is the right default: a deployment that has not deliberately set
   * this has no way to mint a render session at all.
   */
  stillsToken: string;
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

  const databasePath = env.DATABASE_PATH ?? (production ? "./data/saha.db" : ":memory:");

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

  /**
   * Somewhere writable, worked out from a path we know already works.
   *
   * ":memory:" is not a location, so there is nothing to sit beside and the
   * development default is used — which is right for tests, and right for
   * anybody running the dev harness.
   */
  const beside = (known: string, leaf: string, whenNowhere: string): string =>
    known === ":memory:" ? whenNowhere : resolve(dirname(known), leaf);

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
    databasePath,
    blobRoot: env.BLOB_ROOT ?? (production ? "./data/blobs" : "./.dev-blobs"),
    // Kept as a knob rather than hardcoded so a test that binds a real port can
    // silence request logging. Defaults to the level everything ran at before.
    logLevel: env.LOG_LEVEL ?? "info",
    stillsRoot: env.STILLS_ROOT ?? (production ? "./data/stills" : "./.dev-stills"),
    bodyCacheRoot: env.BODY_CACHE_ROOT ?? beside(databasePath, "bodies", "./.dev-bodies"),
    speechCacheRoot: env.SPEECH_CACHE_ROOT ?? beside(databasePath, "speech", "./.dev-speech"),
    stillsToken: env.STILLS_TOKEN ?? "",
  };
}
