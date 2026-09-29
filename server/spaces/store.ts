import type { DatabaseSync } from "node:sqlite";
import type { DeployRecord } from "../../shared/spaces.js";

/**
 * What saha.ing remembers about spaces (migration 44): that a space exists,
 * every deploy with its result, and which deploy each branch is serving.
 * The source itself is the git repository on disk.
 */

type DeployRow = {
  id: string;
  space: string;
  branch: string;
  commit_sha: string;
  message: string;
  author: string;
  pushed_by: string;
  created_at: string;
  status: "ready" | "failed" | "retired";
  problem: string | null;
  files: number;
  bytes: number;
  spa: number;
};

export type StoredDeploy = Omit<DeployRecord, "status"> & { status: DeployRow["status"]; spa: boolean };

const toDeploy = (row: DeployRow): StoredDeploy => ({
  id: row.id,
  space: row.space,
  branch: row.branch,
  commit: row.commit_sha,
  message: row.message,
  author: row.author,
  pushedBy: row.pushed_by,
  createdAt: row.created_at,
  status: row.status,
  problem: row.problem,
  files: row.files,
  bytes: row.bytes,
  spa: row.spa === 1,
});

export class SpaceStore {
  constructor(private readonly db: DatabaseSync) {}

  exists(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM spaces WHERE name = ?").get(name) !== undefined;
  }

  create(name: string, createdBy: string, at: string): void {
    this.db.prepare("INSERT INTO spaces (name, created_by, created_at) VALUES (?, ?, ?)").run(name, createdBy, at);
  }

  get(name: string): { name: string; createdBy: string; createdAt: string } | null {
    const row = this.db.prepare("SELECT name, created_by, created_at FROM spaces WHERE name = ?").get(name) as
      | { name: string; created_by: string; created_at: string }
      | undefined;
    return row ? { name: row.name, createdBy: row.created_by, createdAt: row.created_at } : null;
  }

  all(): string[] {
    return (this.db.prepare("SELECT name FROM spaces ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  }

  record(deploy: StoredDeploy): void {
    this.db.prepare(
      `INSERT INTO space_deploys (id, space, branch, commit_sha, message, author, pushed_by, created_at, status, problem, files, bytes, spa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(deploy.id, deploy.space, deploy.branch, deploy.commit, deploy.message, deploy.author, deploy.pushedBy, deploy.createdAt,
      deploy.status, deploy.problem, deploy.files, deploy.bytes, deploy.spa ? 1 : 0);
  }

  deploy(id: string): StoredDeploy | null {
    const row = this.db.prepare("SELECT * FROM space_deploys WHERE id = ?").get(id) as DeployRow | undefined;
    return row ? toDeploy(row) : null;
  }

  deploys(space: string, limit = 50): StoredDeploy[] {
    return (this.db.prepare("SELECT * FROM space_deploys WHERE space = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(space, limit) as DeployRow[]).map(toDeploy);
  }

  /** The deploy a branch serves right now, if any. */
  live(space: string, branch: string): StoredDeploy | null {
    const row = this.db.prepare(
      "SELECT d.* FROM space_live l JOIN space_deploys d ON d.id = l.deploy_id WHERE l.space = ? AND l.branch = ?",
    ).get(space, branch) as DeployRow | undefined;
    return row ? toDeploy(row) : null;
  }

  liveBranches(space: string): string[] {
    return (this.db.prepare("SELECT branch FROM space_live WHERE space = ? ORDER BY branch").all(space) as { branch: string }[]).map((row) => row.branch);
  }

  setLive(space: string, branch: string, deployId: string): void {
    this.db.prepare(
      "INSERT INTO space_live (space, branch, deploy_id) VALUES (?, ?, ?) ON CONFLICT(space, branch) DO UPDATE SET deploy_id = excluded.deploy_id",
    ).run(space, branch, deployId);
  }

  clearLive(space: string, branch: string): void {
    this.db.prepare("DELETE FROM space_live WHERE space = ? AND branch = ?").run(space, branch);
  }

  /** Ready deploys of a branch beyond the newest `keep`, never the live one: these lose their files. */
  toRetire(space: string, branch: string, keep: number): StoredDeploy[] {
    const liveId = this.live(space, branch)?.id ?? "";
    return (this.db.prepare(
      "SELECT * FROM space_deploys WHERE space = ? AND branch = ? AND status = 'ready' AND id != ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?",
    ).all(space, branch, liveId, Math.max(0, keep - 1)) as DeployRow[]).map(toDeploy);
  }

  retire(id: string): void {
    this.db.prepare("UPDATE space_deploys SET status = 'retired' WHERE id = ?").run(id);
  }
}
