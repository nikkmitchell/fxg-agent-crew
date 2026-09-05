import type { FastifyInstance } from "fastify";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";

/**
 * What is actually running here.
 *
 * This exists because "what is deployed" has been genuinely unclear more than
 * once: a branch deployed while main moved on, a probe against the wrong path
 * concluding a route was missing, a commit live in production that was never
 * merged. Every one of those was resolved by someone reading a file on the box.
 * This puts that file on the screen instead.
 *
 * It reports only what it can read. If DEPLOYED_COMMIT is absent — which is
 * exactly what happens when the service was started by hand rather than by the
 * release script — it says so. A build panel that invents a version is worse
 * than no build panel, because the whole reason to look at one is to find out
 * whether what you think is running is what is running.
 */

export type BuildInfo = {
  /** Branch this was shipped from, or null when nothing recorded it. */
  branch: string | null;
  /**
   * Whether the working tree was clean at ship time.
   *
   * "dirty:N" means the deployed artifact does not correspond to the commit
   * beside it — release.sh warns about that and everyone forgets, so it is
   * recorded rather than trusted to memory.
   */
  tree: string | null;
  /** Commit recorded by the release script, or null when it cannot be read. */
  commit: string | null;
  /** When that record was written, i.e. when the release happened. */
  deployedAt: string | null;
  /** When THIS process started. Differs from deployedAt after a bare restart. */
  processStartedAt: string;
  /**
   * Why commit is null, when it is. Stated so the UI can explain rather than
   * render an empty field that looks like a loading state.
   */
  unavailableReason?: string;
};

export function readBuildInfo(root: string): BuildInfo {
  const processStartedAt = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
  const path = resolve(root, "DEPLOYED_COMMIT");

  // Read alongside the commit. Missing is normal on anything deployed before
  // these were recorded, and is reported as unknown rather than guessed.
  const sidecar = (name: string): string | null => {
    try {
      const value = readFileSync(resolve(root, name), "utf8").trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  };
  const branch = sidecar("DEPLOYED_BRANCH");
  const tree = sidecar("DEPLOYED_TREE");

  try {
    const commit = readFileSync(path, "utf8").trim();
    if (!commit) {
      return { commit: null, branch, tree, deployedAt: null, processStartedAt, unavailableReason: "DEPLOYED_COMMIT is empty" };
    }
    return { commit, branch, tree, deployedAt: statSync(path).mtime.toISOString(), processStartedAt };
  } catch {
    return {
      commit: null,
      branch,
      tree,
      deployedAt: null,
      processStartedAt,
      // The honest reading: this service was not started by the release script,
      // so nothing recorded which commit it came from.
      unavailableReason: "no DEPLOYED_COMMIT file — this service was not started by deploy/release.sh",
    };
  }
}

export function registerBuildRoutes(app: FastifyInstance, config: Config, sessions: SessionStore): void {
  app.get("/bff/build", async (request, reply) => {
    // Behind auth like every other panel: it describes the deployment, which is
    // not something to hand to an unauthenticated caller.
    if (!sessions.get(request.cookies[config.cookieName])) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
    }
    return reply.send(readBuildInfo(process.cwd()));
  });
}
