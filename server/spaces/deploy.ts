import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DEPLOY_LIMITS, parseSettings, publishDir } from "../../shared/spaces.js";
import { readPieces } from "../../shared/space-bench.js";
import { commitInfo, exportBlobs, readBlob, treeFiles } from "./git.js";
import type { SpaceStore, StoredDeploy } from "./store.js";

/**
 * DEPLOYING ONE COMMIT OF ONE BRANCH: find the folder to publish, check it is
 * a size this box can carry, write its files to a fresh directory, and only
 * then point the branch at it. A deploy that fails leaves whatever was live
 * exactly as it was, and says why in the deploy list.
 */

export const siteDir = (root: string, space: string, deployId: string) => join(root, "sites", space, deployId);

export async function deployCommit(options: {
  root: string;
  store: SpaceStore;
  space: string;
  branch: string;
  commit: string;
  pushedBy: string;
  now?: () => Date;
  /** Deploys something stands pinned to (a finished space); never retired. */
  pinned?: () => ReadonlySet<string>;
}): Promise<StoredDeploy> {
  const { root, store, space, branch, commit, pushedBy } = options;
  const now = options.now ?? (() => new Date());
  const id = `${now().getTime().toString(36)}-${commit.slice(0, 7)}-${randomBytes(2).toString("hex")}`;
  const { author, message } = await commitInfo(root, space, commit).catch(() => ({ author: "", message: "" }));
  const base = { id, space, branch, commit, message, author, pushedBy, createdAt: now().toISOString() };
  const failed = (problem: string): StoredDeploy => {
    const deploy: StoredDeploy = { ...base, status: "failed", problem, files: 0, bytes: 0, spa: false };
    store.record(deploy);
    return deploy;
  };

  const files = await treeFiles(root, space, commit);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const settingsFile = byPath.get("saha-space.json");
  const settings = settingsFile ? parseSettings((await readBlob(root, space, settingsFile.sha)).toString("utf8")) : null;
  if (settingsFile && settings === null) return failed("saha-space.json is not valid JSON.");
  const chosen = publishDir(new Set(byPath.keys()), settings);
  if ("problem" in chosen) return failed(chosen.problem);

  // Only what is under the published folder, and never a dotfile or dot-folder
  // (.env, .git-anything): a build folder has no business shipping those.
  const prefix = chosen.dir ? `${chosen.dir}/` : "";
  const shipped = files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, to: file.path.slice(prefix.length) }))
    .filter((file) => file.to.split("/").every((part) => !part.startsWith(".")));
  const bytes = shipped.reduce((sum, file) => sum + file.size, 0);
  if (shipped.length > DEPLOY_LIMITS.files) return failed(`${shipped.length} files is more than a space may publish (${DEPLOY_LIMITS.files}).`);
  if (bytes > DEPLOY_LIMITS.bytes) return failed(`${Math.round(bytes / 1048576)} MB is more than a space may publish (${DEPLOY_LIMITS.bytes / 1048576} MB).`);

  const target = siteDir(root, space, id);
  try {
    await exportBlobs(root, space, shipped, target);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    return failed(`Could not write the files: ${(error as Error).message}`);
  }

  // THE WORKBENCH (shared/space-bench.ts): saha-pieces.json at the top of the
  // repo, or at the top of the published folder. A bad list never fails the
  // deploy; its problems are recorded beside it.
  const piecesFile = byPath.get("saha-pieces.json") ?? byPath.get(`${prefix}saha-pieces.json`);
  const bench = piecesFile
    ? readPieces((await readBlob(root, space, piecesFile.sha)).toString("utf8"), new Map(shipped.map((file) => [file.to, file.size])))
    : { pieces: [], problems: [] };

  const deploy: StoredDeploy = {
    ...base, status: "ready", problem: null, files: shipped.length, bytes, spa: settings?.spa === true,
    pieces: bench.pieces, piecesProblems: bench.problems,
  };
  store.record(deploy);
  store.setLive(space, branch, id);

  // Keep the last few per branch for rolling back, and whatever is pinned; the rest lose their files.
  for (const old of store.toRetire(space, branch, DEPLOY_LIMITS.keepPerBranch, options.pinned?.())) {
    await rm(siteDir(root, space, old.id), { recursive: true, force: true });
    store.retire(old.id);
  }
  return deploy;
}

/**
 * ONE DEPLOY AT A TIME PER SPACE, in the order the pushes arrived, so two
 * quick pushes cannot finish out of order and leave the older one live.
 */
export class DeployQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(space: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(space) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(job);
    this.tails.set(space, next.catch(() => undefined));
    return next;
  }

  /** Resolves when every queued deploy has finished (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }
}
